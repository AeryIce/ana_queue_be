import { Body, Controller, Post, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { RegisterService } from './register.service'
import { RegisterDto, ConfirmDto } from './register.dto'

@Controller('api')
export class RegisterController {
  constructor(private readonly svc: RegisterService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    if (!dto?.email || !dto?.eventId) {
      throw new BadRequestException('email & eventId wajib diisi');
    }
    try {
      return await this.svc.register(dto);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // email bukan master → 404
      if (msg.toLowerCase().includes('master') || msg.toLowerCase().includes('tidak terdaftar')) {
        throw new NotFoundException('Email tidak terdaftar pada master data');
      }
      // duplikat / sudah ada → 409
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
        throw new ConflictException('Email sudah terdaftar / sedang diproses');
      }
      // error lain → 400 (hindari 500 gelap)
      throw new BadRequestException(msg);
    }
  }

  // === NEW: Approve → terbitkan tiket AH-xxx status CONFIRMED ===
  @Post('register-confirm')
  async confirm(@Body() dto: ConfirmDto) {
    if (!dto?.eventId) throw new BadRequestException('eventId wajib diisi');
    if (!dto?.requestId && !dto?.email) throw new BadRequestException('requestId atau email wajib diisi');

    try {
      return await this.svc.confirm(dto);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('pending request not found')) {
        throw new NotFoundException('Data pending tidak ditemukan');
      }
      throw new BadRequestException(msg);
    }
  }
}
