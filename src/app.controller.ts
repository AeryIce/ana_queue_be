import { Controller, Get, Patch, Param, Body, NotFoundException, BadRequestException, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TicketStatus } from '@prisma/client';

@Controller()
export class AppController {
  constructor(private prisma: PrismaService) {}

  @Get()
  root() {
    return 'Hello World!';
  }

  @Get('health')
  health() {
    return { ok: true, at: new Date().toISOString() };
  }

  // Snapshot: 5 antrian QUEUED terdepan + 5 berikutnya
  @Get('api/snapshot')
  async snapshot(@Query('eventId') eventId = 'seed-event') {
    const active = await this.prisma.ticket.findMany({
      where: { eventId, status: TicketStatus.QUEUED },
      orderBy: { order: 'asc' },
      take: 5,
      select: { id: true, code: true, name: true, status: true, order: true },
    });

    const next = await this.prisma.ticket.findMany({
      where: { eventId, status: TicketStatus.QUEUED },
      orderBy: { order: 'asc' },
      skip: 5,
      take: 5,
      select: { id: true, code: true, name: true, status: true, order: true },
    });

    return { eventId, active, next };
  }

  // ---- Aksi Admin ----

  // 1) CALL: QUEUED/DEFERRED -> CALLED + log panggilan
  @Patch('api/tickets/:code/call')
  async callTicket(
    @Param('code') code: string,
    @Body() body: { counterName?: string; note?: string } = {},
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { code } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status !== TicketStatus.QUEUED && ticket.status !== TicketStatus.DEFERRED) {
      throw new BadRequestException(`Cannot CALL from status ${ticket.status}`);
    }

    const counterName = body.counterName || 'Counter A';
    const counter = await this.prisma.counter.upsert({
      where: { name: counterName },
      update: {},
      create: { name: counterName },
      select: { id: true, name: true },
    });

    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: TicketStatus.CALLED },
      select: { id: true, code: true, name: true, status: true, order: true, eventId: true },
    });

    await this.prisma.callLog.create({
      data: {
        ticketId: updated.id,
        counterId: counter.id,
        note: body.note,
      },
    });

    return { ok: true, ticket: updated, counter };
  }

  // 2) IN-PROCESS: CALLED -> IN_PROCESS
  @Patch('api/tickets/:code/in-process')
  async inProcess(@Param('code') code: string) {
    const t = await this.prisma.ticket.findUnique({ where: { code }, select: { id: true, status: true } });
    if (!t) throw new NotFoundException('Ticket not found');
    if (t.status !== TicketStatus.CALLED) {
      throw new BadRequestException(`Cannot set IN_PROCESS from ${t.status}`);
    }
    const updated = await this.prisma.ticket.update({
      where: { id: t.id },
      data: { status: TicketStatus.IN_PROCESS },
    });
    return { ok: true, ticket: updated };
  }

  // 3) DONE: IN_PROCESS/CALLED -> DONE
  @Patch('api/tickets/:code/done')
  async done(@Param('code') code: string) {
    const t = await this.prisma.ticket.findUnique({ where: { code }, select: { id: true, status: true } });
    if (!t) throw new NotFoundException('Ticket not found');
    if (t.status !== TicketStatus.IN_PROCESS && t.status !== TicketStatus.CALLED) {
      throw new BadRequestException(`Cannot set DONE from ${t.status}`);
    }
    const updated = await this.prisma.ticket.update({
      where: { id: t.id },
      data: { status: TicketStatus.DONE },
    });
    return { ok: true, ticket: updated };
  }

  // 4) SKIP: CALLED -> DEFERRED dan dorong ke belakang antrean (order max+1)
  @Patch('api/tickets/:code/skip')
  async skip(@Param('code') code: string) {
    const t = await this.prisma.ticket.findUnique({
      where: { code },
      select: { id: true, status: true, eventId: true },
    });
    if (!t) throw new NotFoundException('Ticket not found');
    if (t.status !== TicketStatus.CALLED) {
      throw new BadRequestException(`Cannot SKIP from ${t.status}`);
    }

    const max = await this.prisma.ticket.aggregate({
      where: { eventId: t.eventId },
      _max: { order: true },
    });
    const newOrder = (max._max.order ?? 0) + 1;

    const updated = await this.prisma.ticket.update({
      where: { id: t.id },
      data: { status: TicketStatus.DEFERRED, order: newOrder },
    });
    return { ok: true, ticket: updated };
  };
  @Get('api/board')
  async board(@Query('eventId') eventId = 'seed-event') {
    const active = await this.prisma.ticket.findMany({
      where: { eventId, status: { in: [TicketStatus.IN_PROCESS, TicketStatus.CALLED] } },
      orderBy: [
        { status: 'desc' },     // enum sort: "IN_PROCESS" > "CALLED"
        { updatedAt: 'asc' },   // yang dipanggil lebih dulu tampil duluan
      ],
      take: 5,
      select: { id: true, code: true, name: true, status: true, order: true, updatedAt: true },
    });

    const next = await this.prisma.ticket.findMany({
      where: { eventId, status: TicketStatus.QUEUED },
      orderBy: { order: 'asc' },
      take: 5,
      select: { id: true, code: true, name: true, status: true, order: true },
    });

    return { eventId, active, next };
}
}