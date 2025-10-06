import { Body, Controller, Post } from '@nestjs/common'
import { RegisterService } from './register.service'
import { RegisterDto } from './register.dto'

@Controller('api')
export class RegisterController {
  constructor(private readonly svc: RegisterService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    if (!dto?.email || !dto?.eventId) {
      return { error: 'email & eventId wajib diisi' }
    }
    return this.svc.register(dto)
  }
}
