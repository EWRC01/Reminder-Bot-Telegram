import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { TelegramReminderBotService } from './telegram-reminder-bot/telegram-reminder-bot.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot()],
  providers: [AppService, TelegramReminderBotService],
})
export class AppModule {}
