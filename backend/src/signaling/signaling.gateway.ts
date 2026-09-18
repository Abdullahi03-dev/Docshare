import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface JoinPayload {
  code: string;
  role: 'sender' | 'receiver';
}

interface SignalPayload {
  code: string;
  // SDP offer/answer or ICE candidate — opaque to the server
  data: unknown;
}

interface RoomState {
  senderId?: string;
  receiverId?: string;
}

/**
 * Minimal WebRTC signaling for Direct (peer-to-peer) transfers.
 *
 * The server never sees file bytes — it only matches two peers by a
 * 4-digit code and relays SDP + ICE messages between them. Once the
 * RTCPeerConnection is up, traffic flows directly (LAN-fast when both
 * peers share a network).
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private rooms = new Map<string, RoomState>();
  private clientRoom = new Map<string, string>(); // socketId -> code

  handleConnection() {
    // no-op: peers announce themselves with `join`
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinPayload,
  ) {
    const code = String(payload?.code ?? '');
    const role = payload?.role;
    if (!/^\d{4}$/.test(code)) return { ok: false, error: 'Invalid code' };
    if (role !== 'sender' && role !== 'receiver')
      return { ok: false, error: 'Invalid role' };

    let room = this.rooms.get(code);
    if (!room) {
      room = {};
      this.rooms.set(code, room);
    }

    if (role === 'sender') {
      if (room.senderId && room.senderId !== client.id)
        return { ok: false, error: 'Code taken, try another' };
      room.senderId = client.id;
    } else {
      if (room.receiverId && room.receiverId !== client.id)
        return { ok: false, error: 'Code taken, try another' };
      room.receiverId = client.id;
    }

    void client.join(code);
    this.clientRoom.set(client.id, code);

    const peerWaiting =
      role === 'sender' ? !!room.receiverId : !!room.senderId;
    client.to(code).emit('peer-joined', { role });
    return { ok: true, peerWaiting };
  }

  @SubscribeMessage('signal')
  handleSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SignalPayload,
  ) {
    const code = String(payload?.code ?? '');
    if (!code || !this.rooms.has(code)) return { ok: false };
    client.to(code).emit('signal', { data: payload.data, from: client.id });
    return { ok: true };
  }

  handleDisconnect(client: Socket) {
    const code = this.clientRoom.get(client.id);
    this.clientRoom.delete(client.id);
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.senderId === client.id) delete room.senderId;
    if (room.receiverId === client.id) delete room.receiverId;
    client.to(code).emit('peer-left', {});
    if (!room.senderId && !room.receiverId) this.rooms.delete(code);
  }
}
