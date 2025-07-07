import React, { useRef, useState } from "react";
import ZoomVideo from "@zoom/videosdk";
import axios from "axios";
import "./App.css";

const App = () => {
  const videoRef = useRef(null);
  const [joined, setJoined] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [signature, setSignature] = useState(null);
  const [error, setError] = useState("");

  const SESSION_NAME = "meeting-test";
  const USER_NAME = "Guest";
  const sdkKey = import.meta.env.VITE_ZOOM_SDK_KEY;

  const startPreview = async () => {
    try {
      const res = await axios.post("http://localhost:4000/generateSignature", {
        sessionName: SESSION_NAME,
        role: 1,
      });

      const sig = res.data.signature;
      console.log("sig", sig);

      setSignature(sig); // Save for full join
      var client = ZoomVideo.createClient();
      await client.init("en-US", "Global", { patchJsMedia: true });
      await client.join(SESSION_NAME, sig, USER_NAME);

      const mediaStream = client.getMediaStream();
      // await mediaStream.startVideo();
      // await mediaStream.startAudio();

      const userId = client.getCurrentUserInfo().userId;
      mediaStream.renderVideo(videoRef.current, userId, 640, 360, 0, 0, 3);

      setPreviewing(true);
    } catch (err) {
      setError("Preview failed: " + (err.reason || err.message));
    }
  };

  return (
    <div className="app-container">
      <h1 className="heading">Zoom Video SDK</h1>
      {error && <div className="error-box">{error}</div>}

      {!joined && !previewing && (
        <button className="join-button" onClick={startPreview}>
          Preview Video
        </button>
      )}
    </div>
  );
};

export default App;
