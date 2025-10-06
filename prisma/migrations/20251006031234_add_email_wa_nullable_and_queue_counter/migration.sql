-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "email" TEXT,
ADD COLUMN     "wa" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_eventId_email_idx" ON "Ticket"("eventId", "email");
