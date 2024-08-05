import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { TelegramReminderBotService } from './telegram-reminder-bot/telegram-reminder-bot.service';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';


@Module({
  imports: [ConfigModule.forRoot()],
  providers: [AppService, TelegramReminderBotService],
  controllers: [AppController],
})
export class AppModule {}
