async function joinAgoraVoice(roomId, username) {
    // 1️⃣ Request Agora config from backend
    const res = await fetch("/api/agora/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: username, roomId })
    });
    const config = await res.json();

    // 2️⃣ Create Agora client
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    // 3️⃣ Join the channel
    const uid = config.uid;
    await client.join(config.appId, config.channel, config.token, uid);

    // 4️⃣ Create and publish local audio track (microphone)
    const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await client.publish([localAudioTrack]);

    console.log(`✅ ${username} joined room ${roomId} and published audio`);

    // 5️⃣ Subscribe to remote users
    client.on("user-published", async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") {
            const audioTrack = user.audioTrack;
            audioTrack.play(); // play remote audio
        }
    });
}
