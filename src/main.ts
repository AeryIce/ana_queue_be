import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true }); // biar FE aman nembak
  await app.listen(process.env.PORT || 4000);
  console.log(`🚀 API running`);
}
bootstrap();
