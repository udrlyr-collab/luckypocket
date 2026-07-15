import { io } from "socket.io-client";

const token = process.env.WS_TOKEN;
if (!token) throw new Error("WS_TOKEN is required");
const socket = io(process.env.WS_URL ?? "https://market.wondering.kr/market", {
  auth: { token },
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 200,
});

let connections = 0;
const timeout = setTimeout(() => { socket.disconnect(); process.stderr.write("WEBSOCKET_RECONNECT_TIMEOUT\n"); process.exit(1); }, 20_000);
socket.on("connect", () => {
  connections += 1;
  if (connections === 1) setTimeout(() => socket.io.engine?.transport.close(), 200);
  else {
    clearTimeout(timeout);
    process.stdout.write("WEBSOCKET_CONNECT_RECONNECT_PASS\n");
    socket.disconnect();
  }
});
socket.on("connect_error", (error) => {
  clearTimeout(timeout);
  process.stderr.write(`WEBSOCKET_CONNECT_ERROR:${error.message}\n`);
  process.exit(1);
});
