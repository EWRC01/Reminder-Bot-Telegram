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
          keyboard: [
            [{ text: 'Cancelar' }],
          ],
        }
      };

      this.bot.sendMessage(chatId, 'Por favor, ingresa el nombre de la medicina.', opts);
    });

    this.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      if (!this.userInputs[chatId]) {
        return;
      }

      switch (this.userInputs[chatId].step) {
        case 1:
          if (text === 'Cancelar') {
            this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
            delete this.userInputs[chatId];
            return;
          }
          this.userInputs[chatId].medicineName = text;
          this.bot.sendMessage(chatId, `Nombre de la medicina registrado: ${text}. Ahora, por favor selecciona la frecuencia. Ejemplo: Diaria, X Veces a la semana, Cancelar`, {
            reply_markup: {
              one_time_keyboard: true,
              resize_keyboard: true,
              keyboard: [
                [{ text: 'Diaria' }],
                [{ text: 'X veces a la semana' }],
                [{ text: 'Cancelar' }],
              ],
            },
          });
          this.userInputs[chatId].step = 2;
          break;
        case 2:
          if (text === 'Cancelar') {
            this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
            delete this.userInputs[chatId];
            return;
          }
          if (text === 'Diaria' || text === 'X veces a la semana') {
            this.userInputs[chatId].frequency = text;
            this.bot.sendMessage(chatId, 'Por favor, ingresa la hora de la notificación (formato 24h, por ejemplo, 14:00).', {
              reply_markup: {
                one_time_keyboard: true,
                resize_keyboard: true,
                keyboard: [
                  [{ text: 'Cancelar' }],
                ],
              },
            });
            this.userInputs[chatId].step = 3;
          } else {
            this.bot.sendMessage(chatId, 'Por favor, selecciona una opción válida: Diaria, X veces a la semana.', {
              reply_markup: {
                one_time_keyboard: true,
                resize_keyboard: true,
                keyboard: [
                  [{ text: 'Diaria' }],
                  [{ text: 'X veces a la semana' }],
                  [{ text: 'Cancelar' }],
                ],
              },
            });
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
              this.bot.sendMessage(chatId, 'Por favor, selecciona los días de la semana para el recordatorio. Puedes usar el formato: Lunes, Miércoles, Viernes.', {
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
              this.bot.sendMessage(chatId, `Hora de la notificación registrada: ${text}. Recordatorio establecido.`, {
                reply_markup: {
                  remove_keyboard: true,
                },
              });

              // Schedule the reminder
              this.scheduleReminder(chatId, this.userInputs[chatId].medicineName, this.userInputs[chatId].frequency, this.userInputs[chatId].time);
              
              // Reset the input step for the next reminder
              delete this.userInputs[chatId];
            }
          } else {
            this.bot.sendMessage(chatId, 'Por favor, ingresa una hora válida en formato 24h (por ejemplo, 14:00).', {
              reply_markup: {
                one_time_keyboard: true,
                resize_keyboard: true,
                keyboard: [
                  [{ text: 'Cancelar' }],
                ],
              },
            });
          }
          break;
        case 4:
          if (text === 'Cancelar') {
            this.bot.sendMessage(chatId, 'El recordatorio ha sido cancelado.');
            delete this.userInputs[chatId];
            return;
          }
          const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
          if (days.includes(text)) {
            if (!this.userInputs[chatId].days.includes(text)) {
              this.userInputs[chatId].days.push(text);
            }
            this.bot.sendMessage(chatId, `Día ${text} registrado. Puedes seleccionar más días o enviar "Listo" cuando hayas terminado.`, {
              reply_markup: {
                one_time_keyboard: true,
                resize_keyboard: true,
                keyboard: [
                  [{ text: 'Listo' }],
                  [{ text: 'Cancelar' }],
                ],
              },
            });
          } else if (text === 'Listo') {
            this.bot.sendMessage(chatId, `Días de la semana registrados: ${this.userInputs[chatId].days.join(', ')}. Hora de la notificación registrada: ${this.userInputs[chatId].time}. Recordatorio establecido.`, {
              reply_markup: {
                remove_keyboard: true,
              },
            });

            // Schedule the reminder
            this.scheduleReminder(chatId, this.userInputs[chatId].medicineName, this.userInputs[chatId].frequency, this.userInputs[chatId].time, this.userInputs[chatId].days);
            
            // Reset the input step for the next reminder
            delete this.userInputs[chatId];
          } else {
            this.bot.sendMessage(chatId, 'Por favor, selecciona un día válido o envía "Listo" cuando hayas terminado.', {
              reply_markup: {
                one_time_keyboard: true,
                resize_keyboard: true,
                keyboard: [
                  [{ text: 'Listo' }],
                  [{ text: 'Cancelar' }],
                ],
              },
            });
          }
          break;
        default:
          this.bot.sendMessage(chatId, 'Entrada no válida, por favor usa el teclado para seleccionar una opción.');
      }
    });
  }

  private scheduleReminder(chatId: number, medicineName: string, frequency: string, time: string, days: string[] = []) {
    const userTimeZone = 'America/El_Salvador'; // Zona horaria para El Salvador
    const [hour, minute] = time.split(':').map(Number);
  
    let cronExpression = '';
    if (frequency === 'Diaria') {
      // Convertir la hora local del usuario a la zona horaria
      cronExpression = `${minute} ${hour} * * *`; // Daily at the specified time
      new CronJob(cronExpression, () => {
        this.bot.sendMessage(chatId, `Recordatorio: Es hora de tomar tu medicina ${medicineName}.`);
      }, null, true, userTimeZone);
    } else if (frequency === 'X veces a la semana') {
      const dayNumbers = { 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6, 'Domingo': 7 };
      days.forEach(day => {
        const dayNumber = dayNumbers[day];
        const weeklyCronExpression = `${minute} ${hour} * * ${dayNumber}`; // Weekly on selected days
        new CronJob(weeklyCronExpression, () => {
          this.bot.sendMessage(chatId, `Recordatorio: Es hora de tomar tu medicina ${medicineName}.`);
        }, null, true, userTimeZone);
      });
    }
  }
  
}
