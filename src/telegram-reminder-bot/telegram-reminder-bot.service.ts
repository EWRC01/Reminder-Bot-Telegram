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
            this.confirmReminder(chatId);
          }
        } else {
          this.bot.sendMessage(chatId, 'Por favor, ingresa una hora válida en formato 24h (por ejemplo, 14:00).');
        }
        break;
      case 4:
        if (text === 'Cancelar') {
          this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
          delete this.userInputs[chatId];
          return;
        }
        const days = text.split(',').map((day) => day.trim());
        this.userInputs[chatId].days = days;
        this.confirmReminder(chatId);
        break;
    }
  }

  private confirmReminder(chatId: number): void {
    const { medicineName, frequency, time, days } = this.userInputs[chatId];
    const daysText = frequency === 'X veces a la semana' ? ` en los días: ${days.join(', ')}` : '';
    this.bot.sendMessage(
      chatId,
      `Recordatorio confirmado para la medicina ${medicineName}, con frecuencia ${frequency} a las ${time}${daysText}.`,
    );

    this.scheduleMedicineReminder(chatId, medicineName, frequency, time, days);
    delete this.userInputs[chatId];
  }

  private calculateWaterIntake(weight: number): number {
    return (weight * 2.2 * 0.0295735) / 2;
  }

  private scheduleWaterReminders(chatId: number, glasses: number, frequency: number): void {
    const userTimeZone = 'America/El_Salvador';
    for (let i = 0; i < glasses; i++) {
      const job = new CronJob(
        `*/${frequency} * * * *`,
        () => {
          this.bot.sendMessage(chatId, 'Es hora de tomar un vaso de agua!');
        },
        null,
        true,
        userTimeZone,
      );

      if (!this.reminders[chatId]) {
        this.reminders[chatId] = [];
      }
      this.reminders[chatId].push(job);
    }
  }

  private scheduleMedicineReminder(
    chatId: number,
    medicineName: string,
    frequency: string,
    time: string,
    days: string[],
  ): void {
    const userTimeZone = 'America/El_Salvador';
    let cronTime = '';

    if (frequency === 'Diaria') {
      const [hour, minute] = time.split(':');
      cronTime = `${minute} ${hour} * * *`;
    } else {
      const daysMap: { [key: string]: number } = {
        Lunes: 1,
        Martes: 2,
        Miércoles: 3,
        Jueves: 4,
        Viernes: 5,
        Sábado: 6,
        Domingo: 0,
      };
      const selectedDays = days.map((day) => daysMap[day]).join(',');
      const [hour, minute] = time.split(':');
      cronTime = `${minute} ${hour} * * ${selectedDays}`;
    }

    const job = new CronJob(
      cronTime,
      () => {
        this.bot.sendMessage(chatId, `¡Es hora de tomar tu medicina: ${medicineName}!`);
      },
      null,
      true,
      userTimeZone,
    );

    if (!this.reminders[chatId]) {
      this.reminders[chatId] = [];
    }
    this.reminders[chatId].push({ job, medicineName });
  }
}
