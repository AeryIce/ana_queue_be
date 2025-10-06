export class RegisterRequestDto {
  eventId!: string
  email!: string
  name!: string
  wa?: string
  // opsional: pakai "GIMMICK" jika request ini khusus pemenang
  source?: 'MASTER' | 'WALKIN' | 'GIMMICK'
}
