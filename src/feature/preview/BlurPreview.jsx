import React, { useEffect, useRef, useState } from "react";
import ZoomVideo from "@zoom/videosdk";

export default function BlurPreview() {
  const videoPlayerRef = useRef(null);
  const clientRef = useRef(null);
  const videoTrackRef = useRef(null);
  const [isBlurred, setIsBlurred] = useState(false);

  useEffect(() => {
    const initZoom = async () => {
      const client = ZoomVideo.createClient();
      clientRef.current = client;

      await client.init("en-US", "Global", {
        patchJsMedia: true,
        enforceVirtualBackground: true,
        enforceMultipleVideos: true,
      });

      // 🔑 Join dummy session before using media
      await client.join(
        "test-session",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhcHBfa2V5IjoiZVl2S3poZnVWV0hrOGRiNTZwSjBxOWdwMG52TnhqMTFwYlVKIiwidHBjIjoidGVzdC1zZXNzaW9uIiwicm9sZV90eXBlIjoxLCJ2ZXJzaW9uIjoxLCJpYXQiOjE3NTIwNTk1ODYsImV4cCI6MTc1MjA2Njc4Nn0.4PbzPYc2cQaFR7K8ZmdUvERdJHye2SAlSt09TnddBQs",
        "user",
        ""
      );

      const track = ZoomVideo.createLocalVideoTrack();
      videoTrackRef.current = track;

      // Start video without blur
      await track.start(videoPlayerRef.current, {
        virtualBackground: undefined,
      });
    };

    initZoom();

    return () => {
      videoTrackRef.current?.stop();
      clientRef.current?.leave();
    };
  }, []);

  const toggleBlur = async () => {
    const track = videoTrackRef.current;
    if (!track) return;

    await track.stop();

    await track.start(videoPlayerRef.current, {
      virtualBackground: isBlurred ? undefined : { imageUrl: "blur" },
    });

    setIsBlurred((prev) => !prev);
  };

  return (
    <div style={{ textAlign: "center", marginTop: 20 }}>
      <video-player-container style={{ width: 640, height: 480 }}>
        <video-player ref={videoPlayerRef} />
      </video-player-container>
      <button onClick={toggleBlur} style={{ marginTop: 12 }}>
        {isBlurred ? "Disable Blur" : "Apply Blur"}
      </button>
    </div>
  );
}
