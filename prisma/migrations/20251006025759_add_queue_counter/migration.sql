-- CreateTable
CREATE TABLE "queue_counters" (
    "eventId" TEXT NOT NULL,
    "nextOrder" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "queue_counters_pkey" PRIMARY KEY ("eventId")
);

-- AddForeignKey
ALTER TABLE "queue_counters" ADD CONSTRAINT "queue_counters_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
