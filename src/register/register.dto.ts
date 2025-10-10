export class RegisterDto {
  email!: string
  wa?: string
  eventId!: string
}

export type Source = 'MASTER' | 'WALKIN' | 'GIMMICK'

export class ConfirmDto {
  eventId!: string          // "seed-event"
  requestId?: string        // id row RegistrationRequest (status=PENDING)
  email?: string            // fallback approve by email
  source!: Source           // MASTER/WALKIN/GIMMICK (pengaruh ledger/pool)
}
