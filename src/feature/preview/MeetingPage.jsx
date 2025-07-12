import React, { useEffect, useRef, useState } from "react";
import { useZoom } from "./ZoomContext";
import axios from "axios";

const MeetingPage = () => {
  const {
    getClient,
    selectedCamera,
    selectedMic,
    userName,
    sessionName,
    cleanup,
  } = useZoom();
  const videoRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const joinSession = async () => {
      try {
        const client = getClient();
        await client.init("en-US", "Global", { patchJsMedia: true });

        // Get signature from your backend
        const res = await axios.post(
          "http://localhost:4000/generateSignature",
          {
            sessionName,
            role: 1,
          }
        );
        const signature = res.data.signature;

        await client.join(sessionName, signature, userName);

        // Start video/audio
        const mediaStream = client.getMediaStream();
        await mediaStream.startVideo();
        await mediaStream.startAudio();

        // Render local video using attachVideo
        const userId = client.getCurrentUserInfo().userId;
        mediaStream.attachVideo(videoRef.current, userId);
      } catch (err) {
        setError("Join failed: " + (err.reason || err.message));
      }
    };

    joinSession();
    return () => {
      cleanup();
    };
  }, [getClient, sessionName, userName, cleanup]);

  return (
    <div className="app-container">
      <h2>Meeting Room</h2>
      {error && <div className="error-box">{error}</div>}
      <div className="local-preview-container">
        <video
          id="meeting-video"
          ref={videoRef}
          width={640}
          height={360}
          autoPlay
          muted
          playsInline
          style={{ background: "black", borderRadius: "12px" }}
        />
      </div>
    </div>
  );
};

export default MeetingPage;
