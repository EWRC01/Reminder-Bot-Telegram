import { Injectable } from '@nestjs/common';
import * as TelegramBot from 'node-telegram-bot-api';
import { CronJob } from 'cron';
import * as moment from 'moment-timezone';

@Injectable()
export class TelegramReminderBotService {
  private readonly bot: TelegramBot;
  private readonly token: string = process.env.TELEGRAM_TOKEN;
  private reminders: { [key: number]: any[] } = {};
  private userInputs: { [key: number]: any } = {};

  constructor() {
    try {
      this.bot = new TelegramBot(this.token, { polling: true });
      this.initializeCommands();
    } catch (error) {
      console.error('Error initializing Telegram bot:', error);
    }

    this.bot.on('polling_error', (error) => {
      console.error('Polling error:', error);
    });
  }

  private initializeCommands(): void {
    this.bot.onText(/\/remind/, (msg) => {
      const chatId = msg.chat.id;
      this.userInputs[chatId] = { step: 1, medicineName: '', frequency: '', time: '', days: [] };

      const opts = {
        reply_markup: {
          one_time_keyboard: true,
          resize_keyboard: true,
          keyboard: [[{ text: 'Cancelar' }]],
        },
      };

      this.bot.sendMessage(chatId, 'Por favor, ingresa el nombre de la medicina.', opts);
    });

    this.bot.onText(/\/water/, (msg) => {
      const chatId = msg.chat.id;
      this.userInputs[chatId] = { step: 1, height: 0, weight: 0 };

      this.bot.sendMessage(chatId, 'Por favor, ingresa tu estatura en centímetros (Ejemplo: 170).');
    });

    this.bot.onText(/\/delete/, (msg) => {
      const chatId = msg.chat.id;
      if (!this.reminders[chatId] || this.reminders[chatId].length === 0) {
        this.bot.sendMessage(chatId, 'No tienes recordatorios de medicina programados.');
        return;
      }

      this.userInputs[chatId] = { step: 'delete', reminderIndex: null };

      const reminderNames = this.reminders[chatId].map((r, index) => ({
        text: `Eliminar ${r.medicineName}`,
        callback_data: index.toString(),
      }));

      const opts = {
        reply_markup: {
          inline_keyboard: [
            ...reminderNames.map((reminder) => [{ text: reminder.text, callback_data: reminder.callback_data }]),
            [{ text: 'Cancelar', callback_data: 'cancel' }],
          ],
        },
      };

      this.bot.sendMessage(chatId, 'Selecciona el recordatorio que deseas eliminar:', opts);
    });

    this.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      if (!this.userInputs[chatId]) {
        return;
      }

      const userStep = this.userInputs[chatId].step;

      if (this.userInputs[chatId].hasOwnProperty('medicineName')) {
        this.handleMedicineReminderSteps(chatId, text, userStep);
      } else if (this.userInputs[chatId].hasOwnProperty('height')) {
        this.handleWaterIntakeSteps(chatId, text, userStep);
      }
    });

    this.bot.on('callback_query', (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;

      if (this.userInputs[chatId]?.step === 'delete') {
        if (data === 'cancel') {
          this.bot.sendMessage(chatId, 'El proceso de eliminación ha sido cancelado.');
          delete this.userInputs[chatId];
          return;
        }

        const reminderIndex = parseInt(data, 10);
        if (!isNaN(reminderIndex) && this.reminders[chatId][reminderIndex]) {
          const reminderName = this.reminders[chatId][reminderIndex].medicineName;
          this.reminders[chatId][reminderIndex].job.stop();
          this.reminders[chatId].splice(reminderIndex, 1);

          this.bot.sendMessage(chatId, `El recordatorio para ${reminderName} ha sido eliminado.`);
        } else {
          this.bot.sendMessage(chatId, 'Selección inválida.');
        }

        delete this.userInputs[chatId];
      }
    });
  }

  private handleWaterIntakeSteps(chatId: number, text: string, step: number) {
    switch (step) {
      case 1:
        if (!isNaN(Number(text)) && Number(text) > 0) {
          this.userInputs[chatId].height = Number(text);
          this.bot.sendMessage(chatId, 'Gracias. Ahora, ingresa tu peso en libras (Ejemplo: 150).');
          this.userInputs[chatId].step = 2;
        } else {
          this.bot.sendMessage(chatId, 'Por favor, ingresa una estatura válida en centímetros.');
        }
        break;
      case 2:
        if (!isNaN(Number(text)) && Number(text) > 0) {
          this.userInputs[chatId].weight = Number(text);
          const waterIntake = this.calculateWaterIntake(this.userInputs[chatId].weight);
          const glasses = Math.ceil(waterIntake / 0.25);
          const frequency = Math.floor((12 * 60) / glasses);

          this.bot.sendMessage(
            chatId,
            `Debes beber aproximadamente ${waterIntake.toFixed(2)} litros de agua al día, lo que equivale a ${glasses} vasos. Te recordaré cada ${frequency} minutos.`,
          );

          this.scheduleWaterReminders(chatId, glasses, frequency);
          delete this.userInputs[chatId];
        } else {
          this.bot.sendMessage(chatId, 'Por favor, ingresa un peso válido en libras.');
        }
        break;
    }
  }

  private handleMedicineReminderSteps(chatId: number, text: string, step: number) {
    switch (step) {
      case 1:
        if (text === 'Cancelar') {
          this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
          delete this.userInputs[chatId];
          return;
        }
        this.userInputs[chatId].medicineName = text;
        this.bot.sendMessage(
          chatId,
          `Nombre de la medicina registrado: ${text}. Ahora, por favor selecciona la frecuencia.`,
          {
            reply_markup: {
              one_time_keyboard: true,
              resize_keyboard: true,
              keyboard: [
                [{ text: 'Diaria' }],
                [{ text: 'X veces a la semana' }],
                [{ text: 'Cancelar' }],
              ],
            },
          },
        );
        this.userInputs[chatId].step = 2;
        break;
      case 2:
        if (text === 'Cancelar') {
          this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
          delete this.userInputs[chatId];
          return;
        }
        if (['Diaria', 'X veces a la semana'].includes(text)) {
          this.userInputs[chatId].frequency = text;
          this.bot.sendMessage(chatId, 'Por favor, ingresa la hora de la notificación (formato 24h, por ejemplo, 14:00).', {
            reply_markup: {
              one_time_keyboard: true,
              resize_keyboard: true,
              keyboard: [[{ text: 'Cancelar' }]],
            },
          });
          this.userInputs[chatId].step = 3;
        } else {
          this.bot.sendMessage(chatId, 'Por favor, selecciona una opción válida: Diaria, X veces a la semana.');
        }
        break;
      case 3:
        if (text === 'Cancelar') {
          this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
          delete this.userInputs[chatId];
          return;
        }
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (timeRegex.test(text)) {
          this.userInputs[chatId].time = text;
          if (this.userInputs[chatId].frequency === 'X veces a la semana') {
            this.bot.sendMessage(chatId, 'Por favor, selecciona los días de la semana para el recordatorio.', {
              reply_markup: {
                one_time_keyboard: true,
                resize_keyboard: true,
                keyboard: [
                  [{ text: 'Lunes' }, { text: 'Martes' }],
                  [{ text: 'Miércoles' }, { text: 'Jueves' }],
                  [{ text: 'Viernes' }, { text: 'Sábado' }],
                  [{ text: 'Domingo' }],
                  [{ text: 'Cancelar' }],
                ],
              },
            });
            this.userInputs[chatId].step = 4;
          } else {
            this.bot.sendMessage(chatId, 'Confirmando el recordatorio...');
            this.scheduleReminders(chatId);
          }
        } else {
          this.bot.sendMessage(chatId, 'Por favor, ingresa una hora válida (formato 24h, por ejemplo, 14:00).');
        }
        break;
      case 4:
        if (text === 'Cancelar') {
          this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
          delete this.userInputs[chatId];
          return;
        }
        const validDays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        if (validDays.includes(text)) {
          if (!this.userInputs[chatId].days) {
            this.userInputs[chatId].days = [];
          }
          if (!this.userInputs[chatId].days.includes(text)) {
            this.userInputs[chatId].days.push(text);
          }
          this.bot.sendMessage(chatId, `Día ${text} añadido. Selecciona otro día o confirma el recordatorio.`, {
            reply_markup: {
              one_time_keyboard: true,
              resize_keyboard: true,
              keyboard: [
                ...validDays.map((day) => [{ text: day }]),
                [{ text: 'Confirmar' }],
                [{ text: 'Cancelar' }],
              ],
            },
          });
        } else if (text === 'Confirmar') {
          this.bot.sendMessage(chatId, 'Confirmando el recordatorio...');
          this.scheduleReminders(chatId);
        } else {
          this.bot.sendMessage(chatId, 'Por favor, selecciona un día válido o confirma el recordatorio.');
        }
        break;
    }
  }

  private scheduleReminders(chatId: number) {
    const reminder = this.userInputs[chatId];
    const time = reminder.time.split(':');
    const hour = parseInt(time[0], 10);
    const minute = parseInt(time[1], 10);

    const daysOfWeek = reminder.frequency === 'X veces a la semana' ? reminder.days : null;

    const job = new CronJob(
      `0 ${minute} ${hour} * * ${daysOfWeek ? daysOfWeek.map(day => this.getCronDay(day)).join(',') : '*'}`,
      () => {
        this.bot.sendMessage(chatId, `Es hora de tomar tu medicina: ${reminder.medicineName}`);
      },
      null,
      true,
      'America/El_Salvador',
    );

    if (!this.reminders[chatId]) {
      this.reminders[chatId] = [];
    }
    this.reminders[chatId].push({ medicineName: reminder.medicineName, job });
    delete this.userInputs[chatId];
  }

  private getCronDay(day: string): string {
    const daysMap = {
      Lunes: '1',
      Martes: '2',
      Miércoles: '3',
      Jueves: '4',
      Viernes: '5',
      Sábado: '6',
      Domingo: '0',
    };
    return daysMap[day];
  }

  private scheduleWaterReminders(chatId: number, glasses: number, frequency: number) {
    const reminderJob = new CronJob(`*/${frequency} * * * *`, () => {
      this.bot.sendMessage(chatId, `Es hora de beber agua. ¡Toma un vaso de agua!`);
    }, null, true, 'America/El_Salvador');

    if (!this.reminders[chatId]) {
      this.reminders[chatId] = [];
    }
    this.reminders[chatId].push({ medicineName: 'Recordatorio de agua', job: reminderJob });
  }

  private calculateWaterIntake(weight: number): number {
    return (weight / 2.2) * 35 / 1000;
  }
}
