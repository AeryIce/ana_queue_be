import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { RegisterRequestService } from './register-request.service';

export class RegisterRequestDto {
  eventId!: string;
  email!: string;
  name!: string;
  wa?: string;
}

@Controller('api')
export class RegisterRequestController {
  constructor(private readonly svc: RegisterRequestService) {}

  @Post('register-request')
  async create(@Body() dto: RegisterRequestDto) {
    if (!dto?.eventId || !dto?.email || !dto?.name) {
      throw new BadRequestException('eventId, email, name wajib diisi');
    }
    // Delegate ke service (tanpa bikin Ticket)
    return this.svc.createRequest(dto);
  }
}
