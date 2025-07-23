import React, { useEffect, useState, useRef } from "react";
import ZoomVideo from "@zoom/videosdk";
import { useNavigate } from "react-router-dom";
import "./Preview.css";
import { useZoom } from "./ZoomContext";

// Persistent tracks (module-level, not per-render)
let localVideoTrack = null;
let localAudioTrack = null;

const Preview = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const {
    selectedCamera,
    setSelectedCamera,
    selectedMic,
    setSelectedMic,
    selectedSpeaker,
    setSelectedSpeaker,
    userName,
    setUserName,
    sessionName,
    setSessionName,
    cleanup: contextCleanup,
    // bgMode and setBgMode removed from context
  } = useZoom();

  // Add local state for bgMode
  const [bgMode, setBgMode] = useState("none");
  // Add local state for role
  const [role, setRole] = useState("1"); // 1 = host, 0 = attendee

  // ========== State for selected options ==========
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]); // mic array
  const [speakerDevices, setSpeakerDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micTestPhase, setMicTestPhase] = useState("idle"); // idle | recording | playing
  const [micTestPlaybackTimeout, setMicTestPlaybackTimeout] = useState(null);
  const [micTestPlaybackWarning, setMicTestPlaybackWarning] = useState("");
  const microPhoneTesterRef = useRef(null);

  const client = useRef(null);

  //========== Fetch Devices on Mount ==========
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const devices = await ZoomVideo.getDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        const mics = devices.filter((d) => d.kind === "audioinput");
        const speakers = devices.filter((d) => d.kind === "audiooutput");

        setVideoDevices(cams);
        setAudioDevices(mics);
        setSpeakerDevices(speakers);
        setSelectedCamera(cams[0]?.deviceId || "");
        setSelectedMic(mics[0]?.deviceId || "");
        setSelectedSpeaker(speakers[0]?.deviceId || "");
      } catch (err) {
        console.error("Error fetching devices:", err);
        setError(
          "Failed to fetch devices. Please check your camera and microphone permissions."
        );
      }
    };
    fetchDevices();
  }, []);

  // ========== Cleanup function ==========
  // Removed duplicate cleanup, use contextCleanup instead

  // ========== Start Preview Camera and Mic ==========
  const startPreview = async () => {
    setIsLoading(true);
    setError("");
    try {
      await contextCleanup();
      client.current = ZoomVideo.createClient();
      await client.current.init("en-US", "Global", {
        patchJsMedia: true,
        virtualBackground: {
          isSupport: true,
          // resources: {
          //   dir: "/lib",
          // },
        },
      });
      // Create and start video track
      if (!localVideoTrack) {
        localVideoTrack = ZoomVideo.createLocalVideoTrack(selectedCamera);
      }
      if (bgMode === "none") {
        await localVideoTrack.start(videoRef.current);
        await localVideoTrack.updateVirtualBackground(undefined);
      } else if (bgMode === "blur") {
        await localVideoTrack.start(canvasRef.current, { imageUrl: "blur" });
      } else if (bgMode === "image") {
        await localVideoTrack.start(canvasRef.current, {
          imageUrl: "/lib/vb-resource/background.jpg",
        });
      }
      // Create and start audio track
      if (!localAudioTrack) {
        localAudioTrack = ZoomVideo.createLocalAudioTrack(selectedMic);
      }
      await localAudioTrack.start();
      await localAudioTrack.unmute();
    } catch (err) {
      // Suppress the "play() request was interrupted" warning for the user
      if (
        err?.message?.includes(
          "The play() request was interrupted by a new load request"
        ) ||
        err?.message?.includes("https://goo.gl/LdLk22")
      ) {
        // Only log to console, do not set user-facing error
        console.warn("Preview warning:", err.message);
        return;
      }
      if (err.name === "NotReadableError") {
        setError(
          "Camera or microphone is already in use by another application. Please close other apps and try again."
        );
      } else {
        setError("Failed to start preview: " + (err.reason || err.message));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ========== Update Virtual Background on Change ==========
  useEffect(() => {
    const updateVB = async () => {
      if (!localVideoTrack) return;
      try {
        // Only stop if the track is started (SDK may not expose isStarted, so try-catch is safest)
        try {
          await localVideoTrack.stop();
        } catch (err) {
          if (err.message && err.message.includes("VideoNotStartedError")) {
            // Ignore, just proceed
          } else {
            throw err;
          }
        }
        if (bgMode === "none") {
          await localVideoTrack.start(videoRef.current);
          await localVideoTrack.updateVirtualBackground(undefined);
        } else if (bgMode === "blur") {
          await localVideoTrack.start(canvasRef.current, { imageUrl: "blur" });
        } else if (bgMode === "image") {
          await localVideoTrack.start(canvasRef.current, {
            imageUrl: "/lib/vb-resource/background.jpg",
          });
        }
      } catch (err) {
        if (err.message && err.message.includes("VideoNotStartedError")) {
          // Try to start the video anyway
          try {
            if (bgMode === "none") {
              await localVideoTrack.start(videoRef.current);
              await localVideoTrack.updateVirtualBackground(undefined);
            } else if (bgMode === "blur") {
              await localVideoTrack.start(canvasRef.current, {
                imageUrl: "blur",
              });
            } else if (bgMode === "image") {
              await localVideoTrack.start(canvasRef.current, {
                imageUrl: "/lib/vb-resource/background.jpg",
              });
            }
          } catch (e) {
            setError(
              "Failed to update virtual background: " + (e.reason || e.message)
            );
          }
          return;
        }
        setError(
          "Failed to update virtual background: " + (err.reason || err.message)
        );
      }
    };
    // Only run if the video element or canvas is mounted
    if (
      (bgMode === "none" && videoRef.current) ||
      ((bgMode === "blur" || bgMode === "image") && canvasRef.current)
    ) {
      updateVB();
    }
  }, [bgMode, videoRef.current, canvasRef.current]);

  useEffect(() => {
    if (selectedCamera && selectedMic) {
      startPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamera, selectedMic]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      contextCleanup();
    };
  }, []);

  // ========== Join Meeting Handler ==========
  const handleJoin = async () => {
    // Stop the preview tracks to release the camera and microphone
    if (localVideoTrack) {
      await localVideoTrack.stop();
    }
    if (localAudioTrack) {
      await localAudioTrack.stop();
    }
    // Clean up module-level variables
    localVideoTrack = null;
    localAudioTrack = null;

    // The context will be updated with the latest user/session name from the input fields
    await contextCleanup(); // Clean up any other context-related resources

    navigate(
      `/meeting?session=${encodeURIComponent(
        sessionName
      )}&user=${encodeURIComponent(userName)}&role=${role}`
    );
  };

  // ========== Mic Testing Feature ==========
  const handleMicTest = () => {
    if (!localAudioTrack) {
      setError("Please start preview first");
      return;
    }
    if (microPhoneTesterRef.current) {
      microPhoneTesterRef.current.stop();
      microPhoneTesterRef.current = null;
      setIsMicTesting(false);
      setMicLevel(0);
      setMicTestPhase("idle");
      setMicTestPlaybackWarning("");
      if (micTestPlaybackTimeout) {
        clearTimeout(micTestPlaybackTimeout);
        setMicTestPlaybackTimeout(null);
      }
      return;
    }
    try {
      setIsMicTesting(true);
      setMicTestPhase("recording");
      setMicTestPlaybackWarning("");
      microPhoneTesterRef.current = localAudioTrack.testMicrophone({
        microphoneId: selectedMic,
        speakerId: selectedSpeaker,
        recordAndPlay: true,
        onAnalyseFrequency: (v) => {
          setMicLevel(Math.round(v * 100));
        },
        onStartRecording: () => {
          console.log("Mic test: onStartRecording");
          setMicTestPhase("recording");
        },
        onStartPlayRecording: () => {
          console.log("Mic test: onStartPlayRecording");
          setMicTestPhase("playing");
          if (micTestPlaybackTimeout) {
            clearTimeout(micTestPlaybackTimeout);
            setMicTestPlaybackTimeout(null);
          }
        },
        onStopPlayRecording: () => {
          console.log("Mic test: onStopPlayRecording");
          microPhoneTesterRef.current = null;
          setIsMicTesting(false);
          setMicLevel(0);
          setMicTestPhase("idle");
          setMicTestPlaybackWarning("");
          if (micTestPlaybackTimeout) {
            clearTimeout(micTestPlaybackTimeout);
            setMicTestPlaybackTimeout(null);
          }
        },
      });
      // Fallback: if playback doesn't start after 5 seconds, show warning
      const timeout = setTimeout(() => {
        if (micTestPhase === "recording") {
          setMicTestPlaybackWarning(
            "Playback not supported in this environment or browser. You may not hear your recording."
          );
        }
      }, 5000);
      setMicTestPlaybackTimeout(timeout);
    } catch (err) {
      console.error("Error testing microphone:", err);
      setError("Failed to test microphone");
      setIsMicTesting(false);
      setMicLevel(0);
      setMicTestPhase("idle");
      setMicTestPlaybackWarning("");
      if (micTestPlaybackTimeout) {
        clearTimeout(micTestPlaybackTimeout);
        setMicTestPlaybackTimeout(null);
      }
    }
  };

  // ========== Speaker Test ==========
  let speakerTester;
  const handleSpeakerTest = () => {
    if (!localAudioTrack) {
      setError("Please start preview first");
      return;
    }
    const levelElm = document.querySelector("#speaker-output-level");
    if (speakerTester) {
      speakerTester.destroy();
      speakerTester = null;
      return;
    }
    try {
      speakerTester = localAudioTrack.testSpeaker({
        speakerId: selectedSpeaker,
        onAnalyseFrequency: (v) => {
          if (levelElm) levelElm.value = v;
        },
      });
    } catch (err) {
      console.error("Error testing speaker:", err);
      setError("Failed to test speaker");
    }
  };

  return (
    <div className="preview-page">
      <div className="preview-container">
        <div className="video-preview">
          {bgMode === "none" ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", height: "100%", background: "black" }}
            ></video>
          ) : (
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              style={{ width: "100%", height: "100%", background: "black" }}
            />
          )}
          {isLoading && <div className="loading">Starting preview...</div>}
          {error && <div className="error">{error}</div>}
        </div>

        <div className="controls">
          <h2>Ready to join?</h2>

          <label>
            Camera:
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
            >
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Microphone:
            <select
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
            >
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Speaker:
            <select
              value={selectedSpeaker}
              onChange={(e) => setSelectedSpeaker(e.target.value)}
            >
              {speakerDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Role:
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{ marginLeft: 8 }}
            >
              <option value="1">Host</option>
              <option value="0">Attendee</option>
            </select>
          </label>

          <label>
            Virtual Background:
            <select value={bgMode} onChange={(e) => setBgMode(e.target.value)}>
              <option value="none">None</option>
              <option value="blur">Blur</option>
              <option value="image">Image</option>
            </select>
          </label>

          <label>
            Session Name:
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Enter session name"
              style={{ marginLeft: 8 }}
            />
          </label>

          <label>
            Your Name:
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              style={{ marginLeft: 8 }}
            />
          </label>

          {/* Shareable meeting link */}
          {sessionName && userName && (
            <div style={{ margin: "12px 0", wordBreak: "break-all" }}>
              <strong>Shareable Meeting Link:</strong>
              <div style={{ background: "#eee", padding: 6, borderRadius: 4 }}>
                {`${
                  window.location.origin
                }/meeting?session=${encodeURIComponent(
                  sessionName
                )}&user=${encodeURIComponent(userName)}&role=${role}`}
              </div>
            </div>
          )}

          <div className="test-controls">
            <button onClick={handleMicTest}>
              {micTestPhase === "recording"
                ? "Recording..."
                : micTestPhase === "playing"
                  ? "Playing..."
                  : isMicTesting
                    ? "Stop"
                    : "Test Microphone"}
            </button>
            <button onClick={handleSpeakerTest}>Test Speaker</button>
          </div>
          <progress
            id="mic-input-level"
            value={micLevel}
            max={100}
            style={{ width: "100%", marginTop: 8 }}
          ></progress>
          {micTestPlaybackWarning && (
            <div style={{ color: "orange", marginTop: 4 }}>
              {micTestPlaybackWarning}
            </div>
          )}

          <button
            className="join-button"
            onClick={handleJoin}
            disabled={isLoading || !selectedCamera || !selectedMic}
          >
            {isLoading ? "Starting..." : "Join Session"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Preview;
