"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisterRequestModule = void 0;
const common_1 = require("@nestjs/common");
const register_request_controller_1 = require("./register-request.controller");
const register_request_service_1 = require("./register-request.service");
const prisma_service_1 = require("../prisma.service");
let RegisterRequestModule = class RegisterRequestModule {
};
exports.RegisterRequestModule = RegisterRequestModule;
exports.RegisterRequestModule = RegisterRequestModule = __decorate([
    (0, common_1.Module)({
        imports: [],
        controllers: [register_request_controller_1.RegisterRequestController],
        providers: [register_request_service_1.RegisterRequestService, prisma_service_1.PrismaService],
        exports: [],
    })
], RegisterRequestModule);
//# sourceMappingURL=register-request.module.js.map