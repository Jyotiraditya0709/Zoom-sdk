import React, { useEffect, useRef, useState } from "react";
import { useZoom } from "../preview/ZoomContext";
import axios from "axios";
import "./MeetingPage.css";
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaVideo,
  FaVideoSlash,
  FaUsers,
  FaCommentDots,
  FaDesktop,
  FaInfoCircle,
  FaSignOutAlt,
} from "react-icons/fa";
import ZoomVideo from "@zoom/videosdk";
import { useLocation, useNavigate } from "react-router-dom";

// Helper functions for robust device fallback
async function createSafeLocalVideoTrack(selectedCamera) {
  try {
    return await ZoomVideo.createLocalVideoTrack({
      cameraId: selectedCamera?.deviceId,
    });
  } catch (err) {
    if (err.name === "OverconstrainedError" || err.name === "NotFoundError") {
      return await ZoomVideo.createLocalVideoTrack();
    }
    throw err;
  }
}

async function createSafeLocalAudioTrack(selectedMic) {
  try {
    return await ZoomVideo.createLocalAudioTrack({
      microphoneId: selectedMic?.deviceId,
    });
  } catch (err) {
    if (err.name === "OverconstrainedError" || err.name === "NotFoundError") {
      return await ZoomVideo.createLocalAudioTrack();
    }
    throw err;
  }
}

// Helper to get deviceId string
function getDeviceId(device) {
  if (!device) return undefined;
  if (typeof device === "string") return device;
  if (typeof device === "object" && device.deviceId) return device.deviceId;
  return undefined;
}

// Utility to safely start a video track with retries and error suppression
async function safeStartVideoTrack(track, videoEl, retries = 3, delay = 300) {
  if (!track || !videoEl) return;
  try {
    videoEl.srcObject = null;
    if (videoEl.load) videoEl.load();
  } catch {}
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((res) => setTimeout(res, delay));
      await track.start(videoEl);
      return;
    } catch (err) {
      const msg = err?.message || "";
      if (
        msg.includes("play() request was interrupted") ||
        msg.includes("Timeout starting video source")
      ) {
        console.warn(`Attempt ${attempt} to start video failed:`, msg);
        if (attempt === retries) throw err;
        continue;
      }
      throw err;
    }
  }
}

const MeetingPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Helper to parse query params
  function getQueryParam(param) {
    const params = new URLSearchParams(location.search);
    return params.get(param);
  }

  // Get sessionName and userName from URL, fallback to context
  const urlSessionName = getQueryParam("session");
  const urlUserName = getQueryParam("user");
  const urlRole = getQueryParam("role");

  const {
    getClient,
    selectedCamera,
    selectedMic,
    userName: contextUserName,
    sessionName: contextSessionName,
    cleanup,
  } = useZoom();

  // Use URL params if present, else context values
  const sessionName = urlSessionName || contextSessionName;
  const userName = urlUserName || contextUserName;
  const role = urlRole !== null ? Number(urlRole) : 1; // default to host if missing

  // Redirect if missing required info
  useEffect(() => {
    if (!sessionName || !userName || role === null || role === undefined) {
      navigate("/", { replace: true });
    }
  }, [sessionName, userName, role, navigate]);

  const [error, setError] = useState("");
  const [participants, setParticipants] = useState([]);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const clientRef = useRef(null);
  const videoRefs = useRef({});
  const videoCanvasRefs = useRef({});
  const localUserIdRef = useRef(null);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const shareVideoRef = useRef(null);
  const shareCanvasRef = useRef(null);
  const shareRenderVideoRef = useRef(null);
  const localVideoTrackRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const [isJoining, setIsJoining] = useState(false);
  const [localUser, setLocalUser] = useState(null);
  const [isTogglingVideo, setIsTogglingVideo] = useState(false);
  const [bgMode, setBgMode] = useState("none");
  const [isBgLoading, setIsBgLoading] = useState(false);

  let localVideoTrack = null;
  let localAudioTrack = null;

  // Helper: Detect WebCodecs support
  const webCodecsEnabled =
    typeof window.MediaStreamTrackProcessor === "function";

  // Utility: Clean up camera/video resources fully
  async function cleanupCamera(userId) {
    const track = localVideoTrackRef.current;
    if (track) {
      await track.stop();
      const m = track.mediaStreamTrack;
      if (m?.stop) m.stop();
      // If Zoom SDK exposes a localMediaStream, stop all tracks
      if (
        track.mediaStream &&
        typeof track.mediaStream.getTracks === "function"
      ) {
        track.mediaStream.getTracks().forEach((t) => t.stop());
      }
      localVideoTrackRef.current = null;
    }
    // Clean up the video element
    const el = videoRefs.current[userId];
    if (el) {
      el.srcObject = null;
      if (el.load) el.load();
    }
  }

  useEffect(() => {
    const getSignature = async () => {
      try {
        const response = await axios.post(
          "https://zoom-sdk-be-1.onrender.com/generateSignature",
          {
            sessionName,
            role,
          }
        );
        return response.data.signature;
      } catch (err) {
        console.error("Failed to get signature:", err);
        throw new Error("Signature fetch failed");
      }
    };

    const joinSession = async () => {
      setIsJoining(true);
      setError("");

      try {
        const client = getClient();
        clientRef.current = client;

        // Leave any existing session before joining a new one
        try {
          await client.leave();
        } catch (e) {
          // Ignore if not joined yet
        }

        // --- Add this block before join ---
        await client.init("en-US", "Global", {
          patchJsMedia: true,
          virtualBackground: { isSupport: true },
        });
        // ----------------------------------

        const token = await getSignature();
        await client.join(sessionName, token, userName);

        const myUser = client.getCurrentUserInfo();
        localUserIdRef.current = myUser.userId;
        setParticipants([myUser]);
        setLocalUser(myUser);

        // Clean up any previous tracks
        if (localVideoTrackRef.current) {
          await localVideoTrackRef.current.stop();
          localVideoTrackRef.current = null;
        }
        if (localAudioTrackRef.current) {
          await localAudioTrackRef.current.stop();
          localAudioTrackRef.current = null;
        }

        // Get deviceId strings
        const cameraId = getDeviceId(selectedCamera);
        const micId = getDeviceId(selectedMic);

        // Create and start local video track
        if (cameraId) {
          localVideoTrackRef.current =
            await ZoomVideo.createLocalVideoTrack(cameraId);
        } else {
          localVideoTrackRef.current = await ZoomVideo.createLocalVideoTrack();
        }
        // Start the video track immediately after joining, like preview.jsx
        const el = videoRefs.current[myUser.userId];
        const canvasEl = videoCanvasRefs.current[myUser.userId];
        if (bgMode === "none" && el) {
          await localVideoTrackRef.current.start(el);
          await localVideoTrackRef.current.updateVirtualBackground(undefined);
        } else if (bgMode === "blur" && canvasEl) {
          await localVideoTrackRef.current.start(canvasEl, {
            imageUrl: "blur",
          });
        } else if (bgMode === "image" && canvasEl) {
          await localVideoTrackRef.current.start(canvasEl, {
            imageUrl: "/lib/vb-resource/background.jpg",
          });
        }

        // Create and start local audio track
        if (micId) {
          localAudioTrackRef.current =
            await ZoomVideo.createLocalAudioTrack(micId);
        } else {
          localAudioTrackRef.current = await ZoomVideo.createLocalAudioTrack();
        }
        await localAudioTrackRef.current.start();
        await localAudioTrackRef.current.unmute();

        setIsVideoOn(true);
        setIsAudioOn(true);

        client.on("user-added", (users) => {
          setParticipants((prev) => [...prev, ...users]);
        });

        client.on("user-removed", (users) => {
          setParticipants((prev) =>
            prev.filter((u) => !users.find((r) => r.userId === u.userId))
          );
        });

        // Screen sharing event handlers
        client.on("share-content-received", ({ userId }) => {
          if (shareVideoRef.current) {
            client
              .getMediaStream()
              .renderShare(shareVideoRef.current, userId, 1280, 720, 0, 0);
          }
        });

        // Handle passive stop share
        client.on("passively-stop-share", () => {
          setIsSharing(false);
          if (shareRenderVideoRef.current)
            shareRenderVideoRef.current.style.display = "none";
          if (shareCanvasRef.current)
            shareCanvasRef.current.style.display = "none";
        });
      } catch (err) {
        console.error("Join error:", err);
        setError("Failed to join session: " + (err.reason || err.message));
      } finally {
        setIsJoining(false);
      }
    };

    joinSession();
    return () => {
      cleanupCamera(localUserIdRef.current);
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current = null;
      }
      cleanup();
    };
  }, [getClient, sessionName, userName, cleanup, selectedCamera, role]);

  // Effect to start video when both track and ref are ready
  useEffect(() => {
    const tryStart = async () => {
      try {
        const el = videoRefs.current[localUser?.userId];
        if (localVideoTrackRef.current && el) {
          await safeStartVideoTrack(localVideoTrackRef.current, el);
        }
      } catch (err) {
        setError("Failed to start local video: " + (err.reason || err.message));
      }
    };
    tryStart();
  }, [localUser]);

  // Effect to update virtual background if bgMode changes in meeting
  useEffect(() => {
    const el = videoRefs.current[localUserIdRef.current];
    const canvasEl = videoCanvasRefs.current[localUserIdRef.current];
    const videoTrack = localVideoTrackRef.current;

    if (!videoTrack || (!el && !canvasEl)) return;

    const updateVB = async () => {
      setIsBgLoading(true);
      try {
        // Always stop before switching
        await videoTrack.stop();
        if (bgMode === "none" && el) {
          await videoTrack.start(el);
          await videoTrack.updateVirtualBackground(undefined);
        } else if (bgMode === "blur" && canvasEl) {
          await videoTrack.start(canvasEl, { imageUrl: "blur" });
        } else if (bgMode === "image" && canvasEl) {
          await videoTrack.start(canvasEl, {
            imageUrl: "/lib/vb-resource/background.jpg",
          });
        }
        setError("");
      } catch (err) {
        setError(
          "Failed to update virtual background: " + (err.reason || err.message)
        );
      } finally {
        setIsBgLoading(false);
      }
    };

    // Only run if the correct element is mounted
    if (
      (bgMode === "none" && el) ||
      ((bgMode === "blur" || bgMode === "image") && canvasEl)
    ) {
      updateVB();
    }
  }, [
    bgMode,
    localUser,
    videoRefs.current[localUserIdRef.current],
    videoCanvasRefs.current[localUserIdRef.current],
  ]);

  // Screen sharing event listeners
  useEffect(() => {
    if (!clientRef.current) return;
    const mediaStream = clientRef.current.getMediaStream();
    const handleShareStarted = () => setIsSharing(true);
    const handleShareStopped = () => {
      setIsSharing(false);
      if (shareRenderVideoRef.current)
        shareRenderVideoRef.current.style.display = "none";
      if (shareCanvasRef.current) shareCanvasRef.current.style.display = "none";
    };
    // For viewers: always use canvas for incoming share
    const handleActiveShareChange = ({ userId, state }) => {
      if (!mediaStream) return;
      if (state === "Active") {
        if (shareCanvasRef.current) {
          mediaStream.startShareView(shareCanvasRef.current, userId);
          shareCanvasRef.current.style.display = "block";
          if (shareRenderVideoRef.current)
            shareRenderVideoRef.current.style.display = "none";
        }
        setIsSharing(true);
      } else {
        mediaStream.stopShareView();
        setIsSharing(false);
        if (shareCanvasRef.current)
          shareCanvasRef.current.style.display = "none";
        if (shareRenderVideoRef.current)
          shareRenderVideoRef.current.style.display = "none";
      }
    };
    // -------------------------------------------------------------------------
    const handleShareReceived = ({ userId }) => {
      if (shareCanvasRef.current) {
        mediaStream.renderShare(
          shareCanvasRef.current,
          userId,
          1280,
          720,
          0,
          0
        );
        shareCanvasRef.current.style.display = "block";
        if (shareRenderVideoRef.current)
          shareRenderVideoRef.current.style.display = "none";
      }
    };
    // FIX: Use clientRef.current.on/off instead of mediaStream.on/off
    clientRef.current.on("share-content-started", handleShareStarted);
    clientRef.current.on("share-content-stopped", handleShareStopped);
    clientRef.current.on("share-content-received", handleShareReceived);
    clientRef.current.on("active-share-change", handleActiveShareChange);
    return () => {
      clientRef.current.off("share-content-started", handleShareStarted);
      clientRef.current.off("share-content-stopped", handleShareStopped);
      clientRef.current.off("share-content-received", handleShareReceived);
      clientRef.current.off("active-share-change", handleActiveShareChange);
    };
  }, [clientRef, shareCanvasRef, shareRenderVideoRef]);

  // Start screen sharing with proper browser compatibility
  const startScreenShare = async () => {
    try {
      const mediaStream = clientRef.current.getMediaStream();
      if (webCodecsEnabled) {
        // Use video element for sharer if WebCodecs is enabled
        await mediaStream.startShareScreen(shareRenderVideoRef.current);
        shareRenderVideoRef.current.style.display = "block";
        shareCanvasRef.current.style.display = "none";
      } else {
        // Use canvas for sharer if WebCodecs is not enabled
        await mediaStream.startShareScreen(shareCanvasRef.current);
        shareCanvasRef.current.style.display = "block";
        shareRenderVideoRef.current.style.display = "none";
      }
      setIsSharing(true);
      setShowShare(false);
    } catch (err) {
      setError(
        "Failed to start screen sharing: " + (err.reason || err.message)
      );
    }
  };

  // Stop screen sharing
  const stopScreenShare = async () => {
    try {
      await clientRef.current.getMediaStream().stopShareScreen();
      if (shareRenderVideoRef.current)
        shareRenderVideoRef.current.style.display = "none";
      if (shareCanvasRef.current) shareCanvasRef.current.style.display = "none";
      setIsSharing(false);
      setShowShare(false);
    } catch (err) {
      setError("Failed to stop screen sharing: " + (err.reason || err.message));
    }
  };

  // Mic toggle logic
  const toggleAudio = async () => {
    try {
      if (!localAudioTrackRef.current) return;
      if (isAudioOn) {
        await localAudioTrackRef.current.mute();
        setIsAudioOn(false);
      } else {
        await localAudioTrackRef.current.unmute();
        setIsAudioOn(true);
      }
    } catch (err) {
      setError("Audio toggle failed: " + (err?.message || err?.name || err));
    }
  };

  // Video toggle logic
  const toggleVideo = async () => {
    if (isTogglingVideo) return;
    setIsTogglingVideo(true);
    try {
      const currentUserId = localUserIdRef.current;
      const videoEl = videoRefs.current[currentUserId];
      const cameraId = getDeviceId(selectedCamera);
      if (isVideoOn) {
        await cleanupCamera(currentUserId);
      } else {
        await new Promise((res) => setTimeout(res, 300));
        if (cameraId) {
          localVideoTrackRef.current =
            await ZoomVideo.createLocalVideoTrack(cameraId);
        } else {
          localVideoTrackRef.current = await ZoomVideo.createLocalVideoTrack();
        }
        if (videoEl) {
          await safeStartVideoTrack(localVideoTrackRef.current, videoEl);
        }
      }
      setIsVideoOn((v) => !v);
    } catch (err) {
      setError("Video toggle failed: " + (err?.message || err?.name || err));
    } finally {
      setIsTogglingVideo(false);
    }
  };

  const leaveSession = async () => {
    await cleanupCamera(localUserIdRef.current);
    await cleanup();
    window.location.href = "/feedback";
  };

  const sendChatMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    try {
      const client = clientRef.current;
      const chatClient = client.getChatClient();
      await chatClient.sendToAll(chatInput);
      setChatMessages((prev) => [
        ...prev,
        {
          sender: userName,
          content: chatInput,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setChatInput("");
    } catch (err) {
      setError("Failed to send message");
    }
  };

  // Modal overlay click handler
  const handleOverlayClick = (closeFn) => (e) => {
    if (e.target.classList.contains("modal")) closeFn();
  };

  // State for background drop-up
  const [showBgDropup, setShowBgDropup] = useState(false);
  const cameraBtnRef = useRef(null);

  // Close drop-up when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (cameraBtnRef.current && !cameraBtnRef.current.contains(e.target)) {
        setShowBgDropup(false);
      }
    }
    if (showBgDropup) {
      document.addEventListener("mousedown", handleClick);
    } else {
      document.removeEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showBgDropup]);

  useEffect(() => {
    if (!clientRef.current) return;
    const client = clientRef.current;
    const handleChatMessage = (payload) => {
      setChatMessages((prev) => [
        ...prev,
        {
          sender: payload.senderName || payload.senderId || "Unknown",
          content: payload.message,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    };
    client.on("chat-message-received", handleChatMessage);
    return () => {
      client.off("chat-message-received", handleChatMessage);
    };
  }, [clientRef]);

  useEffect(() => {
    if (!clientRef.current) return;
    const client = clientRef.current;

    // Helper to subscribe to a user's video
    const subscribeUserVideo = (user) => {
      if (!user || !user.userId) return;
      const el = videoRefs.current[user.userId];
      if (el) {
        client.subscribeVideo(user.userId, el).catch(() => {});
      }
    };

    // Subscribe to video for all current participants (except local)
    participants.forEach((user) => {
      if (user.userId !== localUserIdRef.current) {
        subscribeUserVideo(user);
      }
    });

    // Listen for user video state changes
    const handleUserUpdated = (users) => {
      users.forEach((user) => {
        if (
          user.userId !== localUserIdRef.current &&
          user.videoStatus === "on"
        ) {
          subscribeUserVideo(user);
        }
      });
    };
    client.on("user-updated", handleUserUpdated);

    // Clean up on unmount
    return () => {
      client.off("user-updated", handleUserUpdated);
      // Optionally, unsubscribe from all remote videos
      participants.forEach((user) => {
        if (user.userId !== localUserIdRef.current) {
          try {
            client.unsubscribeVideo(user.userId);
          } catch {}
        }
      });
    };
  }, [participants, clientRef]);

  return (
    <div className="meeting-container">
      <div className="top-bar">Zoom Meeting - {sessionName}</div>

      {/* Shared screen elements (for both sharer and viewer) */}
      {isSharing && (
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            margin: "16px 0",
          }}
        >
          {/* Video element for screen sharing (when browser supports it) */}
          <video
            ref={shareRenderVideoRef}
            autoPlay
            playsInline
            id="my-screen-share-content-video"
            style={{
              display: "none",
              maxWidth: "90vw",
              maxHeight: "60vh",
              borderRadius: 12,
              boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
            }}
          />
          {/* Canvas element for screen sharing (fallback) */}
          <canvas
            ref={shareCanvasRef}
            id="my-screen-share-content-canvas"
            height={720}
            width={1280}
            style={{
              display: "none",
              maxWidth: "90vw",
              maxHeight: "60vh",
              borderRadius: 12,
              boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
            }}
          ></canvas>
          {/* Video element for viewing other users' shared content */}
          <video
            ref={shareVideoRef}
            autoPlay
            playsInline
            style={{
              maxWidth: "90vw",
              maxHeight: "60vh",
              borderRadius: 12,
              boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
            }}
          />
        </div>
      )}

      <div className="video-grid">
        {participants.map((user) => (
          <div className="video-tile" key={user.userId}>
            {/* Video element for "none" background */}
            <video
              ref={(el) => (videoRefs.current[user.userId] = el)}
              autoPlay
              muted={user.userId === localUserIdRef.current}
              playsInline
              className="video-element"
              style={{
                background: "black",
                width: "100%",
                height: "100%",
                display: bgMode === "none" ? "block" : "none",
              }}
            />
            {/* Canvas for blur/image background */}
            <canvas
              ref={(el) => (videoCanvasRefs.current[user.userId] = el)}
              width={1280}
              height={720}
              style={{
                width: "100%",
                height: "100%",
                background: "black",
                display: bgMode !== "none" ? "block" : "none",
              }}
            />
            {/* Show error if local video fails */}
            {user.userId === localUserIdRef.current && error && !isVideoOn && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  color: "#fff",
                  background: "rgba(0,0,0,0.7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  zIndex: 2,
                  textAlign: "center",
                  padding: 16,
                }}
              >
                {error}
              </div>
            )}
            <div className="user-label">{user.displayName}</div>
          </div>
        ))}
      </div>

      <div className="control-bar">
        <button
          className="control-button"
          onClick={toggleAudio}
          title={isAudioOn ? "Mute" : "Unmute"}
        >
          {isAudioOn ? (
            <FaMicrophone size={22} />
          ) : (
            <FaMicrophoneSlash size={22} />
          )}
          <div className="control-label">{isAudioOn ? "Mute" : "Unmute"}</div>
        </button>
        <div
          style={{ position: "relative", display: "inline-block" }}
          ref={cameraBtnRef}
        >
          <button
            className="control-button"
            onClick={toggleVideo}
            title={isVideoOn ? "Stop Video" : "Start Video"}
            disabled={isTogglingVideo}
            style={{ position: "relative" }}
          >
            {isVideoOn ? <FaVideo size={22} /> : <FaVideoSlash size={22} />}
            <div className="control-label">
              {isVideoOn ? "Stop Video" : "Start Video"}
            </div>
          </button>
          <button
            style={{
              position: "absolute",
              right: 0,
              bottom: 40,
              background: "#222",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "2px 8px",
              fontSize: 12,
              cursor: "pointer",
              zIndex: 10,
            }}
            onClick={() => setShowBgDropup((v) => !v)}
            title="Change Background"
          >
            ▼
          </button>
          {showBgDropup && (
            <div
              style={{
                position: "absolute",
                bottom: 50,
                right: 0,
                background: "#222",
                color: "#fff",
                borderRadius: 10,
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                padding: 12,
                minWidth: 120,
                zIndex: 100,
              }}
            >
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                Virtual Background
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 6 }}>
                  <input
                    type="radio"
                    name="bgMode"
                    value="none"
                    checked={bgMode === "none"}
                    onChange={() => {
                      setBgMode("none");
                      setShowBgDropup(false);
                    }}
                  />
                  None
                </label>
                <label style={{ display: "block", marginBottom: 6 }}>
                  <input
                    type="radio"
                    name="bgMode"
                    value="blur"
                    checked={bgMode === "blur"}
                    onChange={() => {
                      setBgMode("blur");
                      setShowBgDropup(false);
                    }}
                  />
                  Blur
                </label>
                <label style={{ display: "block" }}>
                  <input
                    type="radio"
                    name="bgMode"
                    value="image"
                    checked={bgMode === "image"}
                    onChange={() => {
                      setBgMode("image");
                      setShowBgDropup(false);
                    }}
                  />
                  Image
                </label>
              </div>
            </div>
          )}
          {isBgLoading && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                textAlign: "center",
                zIndex: 200,
              }}
            >
              Switching background...
            </div>
          )}
        </div>
        <button
          className="control-button"
          onClick={() => setShowParticipants(true)}
          title="Participants"
        >
          <FaUsers size={22} />
          <div className="control-label">Participants</div>
        </button>
        <button
          className="control-button"
          onClick={() => setShowChat(true)}
          title="Chat"
        >
          <FaCommentDots size={22} />
          <div className="control-label">Chat</div>
        </button>
        <button
          className="control-button"
          onClick={() => setShowInfo(true)}
          title="Info"
        >
          <FaInfoCircle size={22} />
          <div className="control-label">Info</div>
        </button>
        <button
          className="control-button"
          onClick={() => setShowShare(true)}
          title="Share"
        >
          <FaDesktop size={22} />
          <div className="control-label">Share</div>
        </button>
        <button
          className="control-button leave"
          onClick={leaveSession}
          title="Leave"
        >
          <FaSignOutAlt size={22} />
          <div className="control-label">Leave</div>
        </button>
        {isSharing && (
          <span style={{ color: "#00baff", fontWeight: 600, marginLeft: 16 }}>
            Screen sharing active
          </span>
        )}
      </div>

      {/* Participants Sidebar */}
      {showParticipants && (
        <div
          className="modal"
          onClick={handleOverlayClick(() => setShowParticipants(false))}
        >
          <div
            style={{
              background: "#fff",
              color: "#222",
              width: 320,
              height: "100vh",
              padding: 24,
              borderTopLeftRadius: 16,
              borderBottomLeftRadius: 16,
              boxShadow: "-2px 0 12px rgba(0,0,0,0.15)",
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowParticipants(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                background: "none",
                border: "none",
                fontSize: 22,
                cursor: "pointer",
              }}
            >
              ×
            </button>
            <h3 style={{ marginTop: 0 }}>
              Participants ({participants.length})
            </h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {participants.map((user) => (
                <li
                  key={user.userId}
                  style={{
                    margin: "16px 0",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{user.displayName}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {showChat && (
        <div
          className="modal"
          onClick={handleOverlayClick(() => setShowChat(false))}
        >
          <div
            style={{
              background: "#fff",
              color: "#222",
              width: 400,
              maxHeight: 600,
              borderRadius: 16,
              boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
              padding: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: 16,
                borderBottom: "1px solid #eee",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0 }}>Chat</h3>
              <button
                onClick={() => setShowChat(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 22,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 16,
                background: "#f7f7f7",
              }}
            >
              {chatMessages.map((msg, idx) => (
                <div key={idx} style={{ marginBottom: 12 }}>
                  <span style={{ fontWeight: 600 }}>{msg.sender}</span>
                  <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>
                    {msg.timestamp}
                  </span>
                  <div style={{ marginTop: 2 }}>{msg.content}</div>
                </div>
              ))}
            </div>
            <form
              onSubmit={sendChatMessage}
              style={{
                display: "flex",
                borderTop: "1px solid #eee",
                padding: 12,
                background: "#fafafa",
                borderBottomRightRadius: 16,
                borderBottomLeftRadius: 16,
              }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                style={{
                  flex: 1,
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 15,
                }}
              />
              <button
                type="submit"
                style={{
                  marginLeft: 8,
                  background: "#00baff",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShare && (
        <div
          className="modal"
          onClick={handleOverlayClick(() => setShowShare(false))}
        >
          <div
            style={{
              background: "#fff",
              color: "#222",
              width: 340,
              borderRadius: 16,
              boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
              padding: 32,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <button
              onClick={() => setShowShare(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                background: "none",
                border: "none",
                fontSize: 22,
                cursor: "pointer",
              }}
            >
              ×
            </button>
            <h3 style={{ marginTop: 0 }}>Screen Sharing</h3>
            {!isSharing ? (
              <button
                onClick={startScreenShare}
                style={{
                  marginTop: 24,
                  background: "#00baff",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "12px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                Start Sharing
              </button>
            ) : (
              <button
                onClick={stopScreenShare}
                style={{
                  marginTop: 24,
                  background: "#ff4b5c",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "12px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                Stop Sharing
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info Modal */}
      {showInfo && (
        <div
          className="modal"
          onClick={handleOverlayClick(() => setShowInfo(false))}
        >
          <div
            style={{
              background: "#fff",
              color: "#222",
              width: 340,
              borderRadius: 16,
              boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
              padding: 32,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <button
              onClick={() => setShowInfo(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                background: "none",
                border: "none",
                fontSize: 22,
                cursor: "pointer",
              }}
            >
              ×
            </button>
            <h3 style={{ marginTop: 0 }}>Meeting Info</h3>
            <div style={{ marginTop: 16, width: "100%" }}>
              <div>
                <strong>Session:</strong> {sessionName}
              </div>
              <div>
                <strong>Your Name:</strong> {userName}
              </div>
              <div>
                <strong>Participants:</strong> {participants.length}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* {error && <div className="error-box">{error}</div>} */}
    </div>
  );
};

export default MeetingPage;
