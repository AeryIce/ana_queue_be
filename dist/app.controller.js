"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./prisma.service");
const client_1 = require("@prisma/client");
let AppController = class AppController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    root() {
        return 'Hello World!';
    }
    health() {
        return { ok: true, at: new Date().toISOString() };
    }
    async snapshot(eventId = 'seed-event') {
        const active = await this.prisma.ticket.findMany({
            where: { eventId, status: client_1.TicketStatus.QUEUED },
            orderBy: { order: 'asc' },
            take: 5,
            select: { id: true, code: true, name: true, status: true, order: true },
        });
        const next = await this.prisma.ticket.findMany({
            where: { eventId, status: client_1.TicketStatus.QUEUED },
            orderBy: { order: 'asc' },
            skip: 5,
            take: 5,
            select: { id: true, code: true, name: true, status: true, order: true },
        });
        return { eventId, active, next };
    }
    async callTicket(code, body = {}) {
        const ticket = await this.prisma.ticket.findUnique({ where: { code } });
        if (!ticket)
            throw new common_1.NotFoundException('Ticket not found');
        if (ticket.status !== client_1.TicketStatus.QUEUED && ticket.status !== client_1.TicketStatus.DEFERRED) {
            throw new common_1.BadRequestException(`Cannot CALL from status ${ticket.status}`);
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
            data: { status: client_1.TicketStatus.CALLED },
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
    async inProcess(code) {
        const t = await this.prisma.ticket.findUnique({ where: { code }, select: { id: true, status: true } });
        if (!t)
            throw new common_1.NotFoundException('Ticket not found');
        if (t.status !== client_1.TicketStatus.CALLED) {
            throw new common_1.BadRequestException(`Cannot set IN_PROCESS from ${t.status}`);
        }
        const updated = await this.prisma.ticket.update({
            where: { id: t.id },
            data: { status: client_1.TicketStatus.IN_PROCESS },
        });
        return { ok: true, ticket: updated };
    }
    async done(code) {
        const t = await this.prisma.ticket.findUnique({ where: { code }, select: { id: true, status: true } });
        if (!t)
            throw new common_1.NotFoundException('Ticket not found');
        if (t.status !== client_1.TicketStatus.IN_PROCESS && t.status !== client_1.TicketStatus.CALLED) {
            throw new common_1.BadRequestException(`Cannot set DONE from ${t.status}`);
        }
        const updated = await this.prisma.ticket.update({
            where: { id: t.id },
            data: { status: client_1.TicketStatus.DONE },
        });
        return { ok: true, ticket: updated };
    }
    async skip(code) {
        const t = await this.prisma.ticket.findUnique({
            where: { code },
            select: { id: true, status: true, eventId: true },
        });
        if (!t)
            throw new common_1.NotFoundException('Ticket not found');
        if (t.status !== client_1.TicketStatus.CALLED) {
            throw new common_1.BadRequestException(`Cannot SKIP from ${t.status}`);
        }
        const max = await this.prisma.ticket.aggregate({
            where: { eventId: t.eventId },
            _max: { order: true },
        });
        const newOrder = (max._max.order ?? 0) + 1;
        const updated = await this.prisma.ticket.update({
            where: { id: t.id },
            data: { status: client_1.TicketStatus.DEFERRED, order: newOrder },
        });
        return { ok: true, ticket: updated };
    }
    ;
    async board(eventId = 'seed-event') {
        const active = await this.prisma.ticket.findMany({
            where: { eventId, status: { in: [client_1.TicketStatus.IN_PROCESS, client_1.TicketStatus.CALLED] } },
            orderBy: [
                { status: 'desc' },
                { updatedAt: 'asc' },
            ],
            take: 5,
            select: { id: true, code: true, name: true, status: true, order: true, updatedAt: true },
        });
        const next = await this.prisma.ticket.findMany({
            where: { eventId, status: client_1.TicketStatus.QUEUED },
            orderBy: { order: 'asc' },
            take: 5,
            select: { id: true, code: true, name: true, status: true, order: true },
        });
        return { eventId, active, next };
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "root", null);
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "health", null);
__decorate([
    (0, common_1.Get)('api/snapshot'),
    __param(0, (0, common_1.Query)('eventId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "snapshot", null);
__decorate([
    (0, common_1.Patch)('api/tickets/:code/call'),
    __param(0, (0, common_1.Param)('code')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "callTicket", null);
__decorate([
    (0, common_1.Patch)('api/tickets/:code/in-process'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "inProcess", null);
__decorate([
    (0, common_1.Patch)('api/tickets/:code/done'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "done", null);
__decorate([
    (0, common_1.Patch)('api/tickets/:code/skip'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "skip", null);
__decorate([
    (0, common_1.Get)('api/board'),
    __param(0, (0, common_1.Query)('eventId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "board", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AppController);
//# sourceMappingURL=app.controller.js.map