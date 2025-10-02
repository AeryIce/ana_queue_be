import { PrismaService } from './prisma.service';
export declare class AppController {
    private prisma;
    constructor(prisma: PrismaService);
    root(): string;
    health(): {
        ok: boolean;
        at: string;
    };
    snapshot(eventId?: string): Promise<{
        eventId: string;
        active: {
            id: string;
            name: string;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
        }[];
        next: {
            id: string;
            name: string;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
        }[];
    }>;
    callTicket(code: string, body?: {
        counterName?: string;
        note?: string;
    }): Promise<{
        ok: boolean;
        ticket: {
            id: string;
            name: string;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
            eventId: string;
        };
        counter: {
            id: string;
            name: string;
        };
    }>;
    inProcess(code: string): Promise<{
        ok: boolean;
        ticket: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
            eventId: string;
        };
    }>;
    done(code: string): Promise<{
        ok: boolean;
        ticket: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
            eventId: string;
        };
    }>;
    skip(code: string): Promise<{
        ok: boolean;
        ticket: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
            eventId: string;
        };
    }>;
    board(eventId?: string): Promise<{
        eventId: string;
        active: {
            id: string;
            name: string;
            updatedAt: Date;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
        }[];
        next: {
            id: string;
            name: string;
            code: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            order: number;
        }[];
    }>;
}
