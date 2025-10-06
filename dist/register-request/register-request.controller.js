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
exports.RegisterRequestController = void 0;
const common_1 = require("@nestjs/common");
const register_request_service_1 = require("./register-request.service");
const register_request_dto_1 = require("./register-request.dto");
let RegisterRequestController = class RegisterRequestController {
    constructor(svc) {
        this.svc = svc;
    }
    async create(dto) {
        if (!dto?.eventId || !dto?.email || !dto?.name) {
            return { ok: false, error: 'eventId, email, name wajib diisi' };
        }
        return this.svc.createRequest(dto);
    }
    async list(eventId) {
        if (!eventId)
            return { ok: false, error: 'eventId wajib diisi' };
        return this.svc.listPending(eventId);
    }
    async confirm(body) {
        if (!body?.requestId)
            return { ok: false, error: 'requestId wajib diisi' };
        if (!Number.isInteger(body?.useCount) || body?.useCount <= 0) {
            return { ok: false, error: 'useCount harus bilangan > 0' };
        }
        return this.svc.confirm({ requestId: body.requestId, useCount: Number(body.useCount) });
    }
};
exports.RegisterRequestController = RegisterRequestController;
__decorate([
    (0, common_1.Post)('register-request'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_request_dto_1.RegisterRequestDto]),
    __metadata("design:returntype", Promise)
], RegisterRequestController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('register-queue'),
    __param(0, (0, common_1.Query)('eventId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RegisterRequestController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('register-confirm'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RegisterRequestController.prototype, "confirm", null);
exports.RegisterRequestController = RegisterRequestController = __decorate([
    (0, common_1.Controller)('api'),
    __metadata("design:paramtypes", [register_request_service_1.RegisterRequestService])
], RegisterRequestController);
//# sourceMappingURL=register-request.controller.js.map