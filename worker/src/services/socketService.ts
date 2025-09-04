import { Server as SocketIOServer } from 'socket.io';

// Глобальная переменная для хранения экземпляра Socket.IO
let io: SocketIOServer | null = null;

export class SocketService {
  // Инициализация Socket.IO сервера
  static initialize(socketServer: SocketIOServer): void {
    io = socketServer;
    console.log('✅ Socket Service initialized');
  }

  // Получение экземпляра Socket.IO
  static getIO(): SocketIOServer | null {
    return io;
  }

  // Отправка события в комнату проекта
  static emitToProject(projectId: string, event: string, data: any): void {
    if (io) {
      io.to(`project_${projectId}`).emit(event, data);
      console.log(`📡 Emitted ${event} to project ${projectId}`);
    } else {
      console.warn('⚠️ Socket.IO not initialized, cannot emit event');
    }
  }

  // Отправка события всем подключенным клиентам
  static emitToAll(event: string, data: any): void {
    if (io) {
      io.emit(event, data);
      console.log(`📡 Emitted ${event} to all clients`);
    } else {
      console.warn('⚠️ Socket.IO not initialized, cannot emit event');
    }
  }

  // Отправка события конкретному клиенту
  static emitToClient(socketId: string, event: string, data: any): void {
    if (io) {
      io.to(socketId).emit(event, data);
      console.log(`📡 Emitted ${event} to client ${socketId}`);
    } else {
      console.warn('⚠️ Socket.IO not initialized, cannot emit event');
    }
  }

  // Получение количества подключенных клиентов в комнате
  static getRoomSize(projectId: string): number {
    if (io) {
      const room = io.sockets.adapter.rooms.get(`project_${projectId}`);
      return room ? room.size : 0;
    }
    return 0;
  }

  // Получение общего количества подключенных клиентов
  static getTotalConnections(): number {
    if (io) {
      return io.sockets.sockets.size;
    }
    return 0;
  }
}
