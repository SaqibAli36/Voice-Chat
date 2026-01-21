# app.py
from flask import Flask, request, send_from_directory, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
from datetime import datetime
import os
from dotenv import load_dotenv

# ========== LOAD .ENV ==========
load_dotenv()  # Make sure .env is in the same folder as this app.py

# ========== FLASK SETUP ==========
app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    ping_timeout=60,
    ping_interval=25
)

# ========== AGORA CONFIG ==========
AGORA_APP_ID = os.environ.get("AGORA_APP_ID")
if not AGORA_APP_ID:
    raise RuntimeError("⚠️ AGORA_APP_ID not set in .env")

# ========== DATA STORAGE ==========
rooms = {}

# ========== HELPERS ==========
def get_or_create_room(room_id):
    room_id = str(room_id)
    if room_id not in rooms:
        rooms[room_id] = {
            "users": {},
            "messages": [],
            "mic_slots": {},
            "user_slots": {},
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
    return rooms[room_id]

def update_room_timestamp(room_id):
    if room_id in rooms:
        rooms[room_id]["updated_at"] = datetime.now().isoformat()

# ========== ROUTES ==========
@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/chat")
def chat():
    return send_from_directory(app.static_folder, "chat.html")

@app.route("/api/health")
def health():
    return jsonify({
        "status": "healthy",
        "rooms": len(rooms),
        "agora_app_id_set": bool(AGORA_APP_ID)
    })

@app.route("/api/agora/appid", methods=["GET"])
def get_agora_appid():
    """Frontend fetches the App ID from this endpoint."""
    return jsonify({"appId": AGORA_APP_ID})

@app.route("/api/agora/config", methods=["POST"])
def agora_config():
    """Return a test config for frontend to join Agora (no token)."""
    data = request.get_json() or {}
    user_id = data.get("userId", f"user_{int(datetime.now().timestamp())}")
    room_id = str(data.get("roomId", "default"))

    return jsonify({
        "appId": AGORA_APP_ID,
        "channel": room_id,
        "uid": user_id,
        "token": None,  # No token for App ID–only mode
        "success": True,
        "mode": "test"
    })

# ========== SOCKET EVENTS ==========
@socketio.on("connect")
def connect():
    emit("connected", {"sid": request.sid})

@socketio.on("disconnect")
def disconnect():
    for room_id, room in list(rooms.items()):
        if request.sid in room["users"]:
            username = room["users"][request.sid]["name"]
            del room["users"][request.sid]

            msg = {
                "user": "System",
                "text": f"{username} left the room",
                "timestamp": datetime.now().isoformat()
            }
            room["messages"].append(msg)
            emit("new_message", msg, room=room_id)

            if not room["users"]:
                del rooms[room_id]
            break

@socketio.on("join_room")
def join(data):
    room_id = str(data.get("roomId"))
    username = data.get("userName", "User")

    room = get_or_create_room(room_id)
    room["users"][request.sid] = {
        "name": username,
        "joined_at": datetime.now().isoformat()
    }

    join_room(room_id)

    emit("room_data", {
        "users": list(room["users"].values()),
        "micSlots": room["mic_slots"],
        "roomId": room_id,
        "yourName": username
    }, to=request.sid)

    msg = {
        "user": "System",
        "text": f"{username} joined the room",
        "timestamp": datetime.now().isoformat()
    }

    room["messages"].append(msg)
    emit("new_message", msg, room=room_id, include_self=False)

@socketio.on("send_message")
def message(data):
    room_id = str(data.get("roomId"))
    text = data.get("text", "").strip()
    username = data.get("userName", "User")

    if not text or room_id not in rooms:
        return

    msg = {
        "user": username,
        "text": text,
        "timestamp": datetime.now().isoformat()
    }

    rooms[room_id]["messages"].append(msg)
    emit("new_message", msg, room=room_id)

@socketio.on("join_mic")
def join_mic(data):
    room_id = str(data.get("roomId"))
    slot = str(data.get("slot"))
    username = data.get("userName")

    room = rooms.get(room_id)
    if not room:
        return

    if slot in room["mic_slots"]:
        emit("mic_error", {"message": "Slot already taken"}, to=request.sid)
        return

    room["mic_slots"][slot] = username
    room["user_slots"][username] = slot

    emit("mic_update", room["mic_slots"], room=room_id)

@socketio.on("leave_mic")
def leave_mic(data):
    room_id = str(data.get("roomId"))
    username = data.get("userName")

    room = rooms.get(room_id)
    if not room:
        return

    slot = room["user_slots"].get(username)
    if slot:
        del room["mic_slots"][str(slot)]
        del room["user_slots"][username]
        emit("mic_update", room["mic_slots"], room=room_id)

# ========== ERROR HANDLERS ==========
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

# ========== RUN ==========
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Server running on port {port}")
    print(f"🎤 Agora App ID Mode Enabled: {AGORA_APP_ID}")
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=True,
        allow_unsafe_werkzeug=True
    )
