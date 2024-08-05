import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {

 getHello(): string {
  return 'Telegram bot is up';
 }
}
