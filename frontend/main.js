const joinBtn = document.getElementById("joinBtn");

async function joinAgora() {
    // 1️⃣ Request config from your Flask backend
    const res = await fetch("/api/agora/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            userId: "testUser",
            roomId: "testRoom"
        })
    });
    const config = await res.json();

    // 2️⃣ Create Agora client
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    // 3️⃣ Join channel
    const uid = config.uid;
    await client.join(config.appId, config.channel, config.token, uid);

    // 4️⃣ Create and publish local audio track (microphone)
    const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await client.publish([localAudioTrack]);

    console.log("✅ Joined Agora channel and published audio!");

    // 5️⃣ Subscribe to remote audio tracks
    client.on("user-published", async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") {
            const audioTrack = user.audioTrack;
            audioTrack.play(); // play remote audio
        }
    });
}

joinBtn.addEventListener("click", joinAgora);
