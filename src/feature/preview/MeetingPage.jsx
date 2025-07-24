import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import ZoomVideo from "@zoom/videosdk";
import { useZoom } from "../preview/ZoomContext";
import "./MeetingPage.css";
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaVideo,
  FaVideoSlash,
  FaUsers,
  FaCommentDots,
  FaSignOutAlt,
  FaChevronUp,
  FaCamera,
  FaVolumeUp,
  FaVolumeMute,
  FaSignal,
} from "react-icons/fa";

const MeetingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { getClient, cleanup: zoomCleanup } = useZoom();

  // State
  const [participants, setParticipants] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [isJoining, setIsJoining] = useState(true);
  const [error, setError] = useState("");
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [bgMode, setBgMode] = useState("none");
  const [showModals, setShowModals] = useState({
    participants: false,
    chat: false,
  });
  const [chatInput, setChatInput] = useState("");
  const [showVideoOptions, setShowVideoOptions] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [isRemoteSharing, setIsRemoteSharing] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const screenShareContainerRef = useRef(null);
  const remoteShareContainerRef = useRef(null);
  const [annotationError, setAnnotationError] = useState("");
  const [recordingStatus, setRecordingStatus] = useState("stopped"); // "stopped" | "recording" | "paused"
  const [showRecordingNotice, setShowRecordingNotice] = useState(false);
  const recordingClientRef = useRef(null);
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [speakerDevices, setSpeakerDevices] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMic, setSelectedMic] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState("");
  const [permissionError, setPermissionError] = useState("");
  const [activeSpeakerId, setActiveSpeakerId] = useState(null);
  const [notifications, setNotifications] = useState([]);
  // Notification helper (move this above useEffect)
  const addNotification = useCallback((msg) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => {
      const next = [...prev, { id, msg }];
      return next.slice(-4); // Limit to last 4
    });
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  }, []);
  const [networkQuality, setNetworkQuality] = useState({}); // { userId: level }
  const aspectRatioRefs = useRef({}); // { userId: aspectRatio }
  const [showEndMeetingConfirm, setShowEndMeetingConfirm] = useState(false);

  // Refs
  const clientRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const videoContainerRefs = useRef({});
  const selfUserIdRef = useRef(null);
  const VIDEO_QUALITY = 1; // 1: 360p, 3: 720p

  // Parse URL Params
  const { sessionName, userName, role } = React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      sessionName: params.get("session") || "default-session",
      userName: params.get("user") || "Guest",
      role: parseInt(params.get("role") || "1", 10),
    };
  }, [location.search]);
  const isHost = role === 1;

  const attachVideo = useCallback(
    async (userId) => {
      const container = videoContainerRefs.current[userId];
      if (container && mediaStreamRef.current) {
        try {
          const userVideo = await mediaStreamRef.current.attachVideo(
            userId,
            VIDEO_QUALITY
          );
          container.innerHTML = "";
          container.appendChild(userVideo);
        } catch (e) {
          console.error(`Failed to attach video for ${userId}`, e);
        }
      }
    },
    [VIDEO_QUALITY]
  );

  const detachVideo = useCallback(async (userId) => {
    if (mediaStreamRef.current) {
      try {
        await mediaStreamRef.current.detachVideo(userId);
      } catch (e) {
        console.error(`Failed to detach video for ${userId}`, e);
      }
    }
  }, []);

  // Main session lifecycle effect
  useEffect(() => {
    const client = getClient();
    clientRef.current = client;

    // Fetch devices and set state
    const fetchDevices = async () => {
      try {
        const devices = await ZoomVideo.getDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        const mics = devices.filter((d) => d.kind === "audioinput");
        const speakers = devices.filter((d) => d.kind === "audiooutput");
        setVideoDevices(cams);
        setAudioDevices(mics);
        setSpeakerDevices(speakers);
        if (!selectedCamera && cams[0]) setSelectedCamera(cams[0].deviceId);
        if (!selectedMic && mics[0]) setSelectedMic(mics[0].deviceId);
        if (!selectedSpeaker && speakers[0])
          setSelectedSpeaker(speakers[0].deviceId);
      } catch (err) {
        setError(
          "Failed to fetch devices. Please check your camera and microphone permissions."
        );
      }
    };
    fetchDevices();

    // Listen for device-change event
    client.on("device-change", fetchDevices);

    // Listen for permission-change event
    client.on("permission-change", (payload) => {
      setPermissionError(
        "Camera or microphone permission changed. Please re-authorize in your browser settings."
      );
    });

    const getSignature = async () => {
      try {
        const response = await axios.post(
          "https://zoom-sdk-be-1.onrender.com/generateSignature",
          { sessionName, role }
        );
        return response.data.signature;
      } catch (err) {
        setError("Failed to get a valid signature.");
        return null;
      }
    };

    const setupEventListeners = () => {
      client.on("user-added", () => setParticipants(client.getAllUser()));
      client.on("user-removed", () => setParticipants(client.getAllUser()));

      client.on("chat-on-message", (payload) => {
        setChatMessages((prev) => [
          ...prev,
          {
            sender: payload.sender.name,
            content: payload.message,
            timestamp: new Date(payload.timestamp).toLocaleTimeString(),
          },
        ]);
      });

      client.on("peer-video-state-change", async (payload) => {
        const { action, userId } = payload;
        if (userId === selfUserIdRef.current) return; // Ignore self events
        if (action === "Start") {
          await attachVideo(userId);
        } else if (action === "Stop") {
          await detachVideo(userId);
        }
        // Update participants state so UI reflects remote video changes
        setParticipants(client.getAllUser());
      });

      // Add peer-audio-state-change listener to update participants state
      client.on("peer-audio-state-change", () => {
        setParticipants(client.getAllUser());
      });
    };

    const joinSession = async () => {
      try {
        await client.init("en-US", "Global", {
          patchJsMedia: true,
          virtualBackground: { isSupport: true },
        });
        const signature = await getSignature();
        if (!signature) return;

        await client.join(sessionName, signature, userName);
        // Leave on page unload
        if (client.leaveOnPageUnload) client.leaveOnPageUnload();
        mediaStreamRef.current = client.getMediaStream();
        selfUserIdRef.current = client.getCurrentUserInfo().userId;
        setParticipants(client.getAllUser());

        setTimeout(async () => {
          // Start audio
          await mediaStreamRef.current.startAudio();
          setIsAudioOn(true);

          // Start and attach self video
          try {
            await mediaStreamRef.current.startVideo();
            setIsVideoOn(true);
            await attachVideo(selfUserIdRef.current);
          } catch (e) {
            if (e?.errorCode === 6105) {
              // Camera is still starting, show a small message and optionally retry
              setError("Camera is still starting, please wait and try again.");
              // Optionally, retry after 1 second:
              // setTimeout(() => toggleVideo(), 1000);
              return;
            }
            console.error("Failed to start self video", e);
            setError("Could not start camera. Check permissions.");
          }

          // Attach videos for users already in the session
          client.getAllUser().forEach(async (user) => {
            if (user.bVideoOn && user.userId !== selfUserIdRef.current) {
              await attachVideo(user.userId);
            }
          });

          // Cloud recording logic
          recordingClientRef.current = client.getRecordingClient();
          // REMOVE: Start recording automatically if host
          // if (isHost && recordingClientRef.current.canStartRecording()) {
          //   const res = await recordingClientRef.current.startCloudRecording();
          //   if (res === "") {
          //     setRecordingStatus("recording");
          //     setShowRecordingNotice(true);
          //   }
          // }
          // If not host, just show the notice if recording is active
          if (
            !isHost &&
            recordingClientRef.current.getCloudRecordingStatus() === "recording"
          ) {
            setShowRecordingNotice(true);
          }
        }, 500); // Small delay to allow React to render containers

        setupEventListeners();
      } catch (err) {
        console.error("Join error:", err);
        setError("Failed to join the session.");
      } finally {
        setIsJoining(false);
      }
    };

    joinSession();

    // Add screen share event listeners
    client.on("passively-stop-share", () => {
      setIsSharingScreen(false);
    });

    client.on("active-share-change", (payload) => {
      if (!mediaStreamRef.current) return;
      if (payload.state === "Active") {
        setIsRemoteSharing(true);
        mediaStreamRef.current.startShareView(
          remoteShareContainerRef.current,
          payload.userId
        );
      } else if (payload.state === "Inactive") {
        setIsRemoteSharing(false);
        mediaStreamRef.current.stopShareView();
      }
    });

    // Optional: Listen for annotation privilege changes
    client.on(
      "annotation-privilege-change",
      ({ userId, isAnnotationEnabled }) => {
        if (!isAnnotationEnabled && isAnnotating) {
          stopAnnotation();
        }
      }
    );

    // Listen for active speaker changes
    client.on("video-active-change", (payload) => {
      setActiveSpeakerId(payload.userId);
    });

    // User join/leave notifications
    const handleUserAdded = (payload) => {
      payload.forEach((item) => {
        addNotification(
          `${item.displayName || item.userId} joined the session.`
        );
      });
      setParticipants(client.getAllUser());
    };
    const handleUserRemoved = (payload) => {
      payload.forEach((item) => {
        addNotification(`${item.displayName || item.userId} left the session.`);
      });
      setParticipants(client.getAllUser());
    };
    client.on("user-added", handleUserAdded);
    client.on("user-removed", handleUserRemoved);

    // Connection status handling
    client.on("connection-change", (payload) => {
      if (payload.state === "Closed") {
        addNotification(
          payload.reason === "ended by host"
            ? "The host has ended the meeting."
            : `Session ended: ${payload.reason || "Closed by host or network"}`
        );
        setError("Session ended. Please rejoin.");
      } else if (payload.state === "Reconnecting") {
        addNotification(`Reconnecting to session...`);
      } else if (payload.state === "Connected") {
        addNotification(`Connected to session.`);
      } else if (payload.state === "Fail") {
        addNotification(
          `Session failed: ${payload.reason || payload.errorCode}`
        );
        setError("Session failed. Please refresh.");
      }
    });

    // Device plug/unplug and permission changes
    client.on("device-change", fetchDevices);
    client.on("device-permission-change", (payload) => {
      addNotification(`${payload.name} permission is ${payload.state}`);
      if (payload.state === "denied") {
        setError(
          `${payload.name} permission denied. Please grant it in browser settings.`
        );
      }
    });

    // Media failure handling
    client.on("active-media-failed", (payload) => {
      addNotification(`Media error: ${payload.message || payload.code}`);
      setError(`Media error: ${payload.message || payload.code}`);
    });

    // Audio/video state changes
    client.on("current-audio-change", (payload) => {
      if (payload.action === "Leave") {
        addNotification(`Audio ended: ${payload.source}`);
      } else if (payload.action === "Muted") {
        addNotification(`Audio muted: ${payload.source}`);
      }
    });

    // Auto-play audio failure
    client.on("auto-play-audio-failed", () => {
      addNotification(
        `Audio playback blocked. Click anywhere to resume audio.`
      );
    });

    // Network quality indicator
    client.on("network-quality-change", (payload) => {
      setNetworkQuality((prev) => ({
        ...prev,
        [payload.userId]: payload.level,
      }));
    });

    // Dynamic video aspect ratio
    client.on("video-aspect-ratio-change", (payload) => {
      aspectRatioRefs.current[payload.userId] = payload.aspectRatio;
      // Optionally, force a re-render
      // Removed notification for aspect ratio change
      // addNotification(`Aspect ratio changed for user ${payload.userId}`);
    });

    return () => {
      if (clientRef.current) {
        clientRef.current.leave();
      }
      zoomCleanup();
      client.off("user-added", handleUserAdded);
      client.off("user-removed", handleUserRemoved);
      client.off("connection-change");
      client.off("device-change");
      client.off("device-permission-change");
      client.off("active-media-failed");
      client.off("current-audio-change");
      client.off("user-updated");
      client.off("auto-play-audio-failed");
      client.off("network-quality-change");
      client.off("video-aspect-ratio-change");
    };
  }, []);

  // Effect to start recording when more than one user is present
  useEffect(() => {
    if (!isHost || !recordingClientRef.current) return;
    if (recordingStatus !== "recording" && participants.length > 1) {
      (async () => {
        if (recordingClientRef.current.canStartRecording()) {
          const res = await recordingClientRef.current.startCloudRecording();
          if (res === "") {
            setRecordingStatus("recording");
            setShowRecordingNotice(true);
          }
        }
      })();
    }
  }, [participants.length, isHost, recordingStatus]);

  const toggleAudio = useCallback(async () => {
    if (mediaStreamRef.current) {
      if (isAudioOn) {
        await mediaStreamRef.current.muteAudio();
      } else {
        await mediaStreamRef.current.unmuteAudio();
      }
      setIsAudioOn(!isAudioOn);
      // Force update participants to reflect local audio state
      if (clientRef.current) setParticipants(clientRef.current.getAllUser());
      // Manually emit peer-audio-state-change for local user to update UI globally
      if (clientRef.current) {
        const event = new Event("peer-audio-state-change");
        clientRef.current.emit &&
          clientRef.current.emit("peer-audio-state-change", {
            userId: selfUserIdRef.current,
            action: isAudioOn ? "Muted" : "Unmuted",
          });
      }
    }
  }, [isAudioOn]);

  const toggleVideo = useCallback(async () => {
    if (!mediaStreamRef.current) return;
    try {
      if (isVideoOn) {
        await mediaStreamRef.current.stopVideo();
        await detachVideo(selfUserIdRef.current);
        setIsVideoOn(false);
      } else {
        await mediaStreamRef.current.startVideo();
        await attachVideo(selfUserIdRef.current);
        setIsVideoOn(true);
      }
    } catch (e) {
      console.error("Toggle video error", e);
    }
  }, [isVideoOn, attachVideo, detachVideo]);

  const handleBgChange = async (e) => {
    const newBgMode = e.target.value;
    if (!mediaStreamRef.current) return;
    try {
      // detachVideo is not needed here as startVideo will handle the stream.
      await mediaStreamRef.current.stopVideo();

      let vbOptions = {};
      if (newBgMode === "blur") {
        vbOptions = { virtualBackground: { imageUrl: "blur" } };
      } else if (newBgMode === "image") {
        vbOptions = {
          virtualBackground: { imageUrl: "/lib/vb-resource/background.jpg" },
        };
      }

      await mediaStreamRef.current.startVideo(vbOptions);
      setBgMode(newBgMode);
      setIsVideoOn(true);

      // Re-attach video after changing background
      await attachVideo(selfUserIdRef.current);
    } catch (err) {
      console.error("Error updating VB:", err);
      setError("Failed to switch background.");
      // If it fails, try to restart video without VB
      if (!isVideoOn) {
        await mediaStreamRef.current.startVideo();
        await attachVideo(selfUserIdRef.current);
        setIsVideoOn(true);
      }
    }
  };

  const handleModal = (modal, state) =>
    setShowModals((prev) => ({ ...prev, [modal]: state }));

  const sendChatMessage = useCallback(
    async (e) => {
      e.preventDefault();
      if (!chatInput.trim()) return;
      try {
        await clientRef.current.getChatClient().sendToAll(chatInput);
        setChatInput("");
      } catch (err) {
        console.error("Send chat error:", err);
      }
    },
    [chatInput]
  );

  // Screen share start/stop logic
  const handleScreenShare = async () => {
    console.log(
      "handleScreenShare called",
      screenShareContainerRef.current,
      isSharingScreen
    );
    if (!mediaStreamRef.current) {
      console.log("mediaStreamRef.current is null");
      return;
    }
    try {
      if (!isSharingScreen) {
        const el = screenShareContainerRef.current;
        if (!el) {
          setError("Screen share element not found.");
          console.log("Screen share element not found");
          return;
        }
        if (mediaStreamRef.current.isStartShareScreenWithVideoElement()) {
          console.log("Starting share with video element");
          await mediaStreamRef.current.startShareScreen(el);
        } else {
          console.log("Starting share with canvas element");
          await mediaStreamRef.current.startShareScreen(el);
        }
        setIsSharingScreen(true);
        console.log("Screen sharing started");
      } else {
        await mediaStreamRef.current.stopShareScreen();
        setIsSharingScreen(false);
        console.log("Screen sharing stopped");
      }
    } catch (err) {
      if (err?.reason === "user deny screen share" || err?.errorCode === 6200) {
        // User cancelled, do nothing or show a toast/snackbar
        setIsSharingScreen(false);
        return;
      }
      setError("Screen share failed.");
      setIsSharingScreen(false);
      console.log("Screen share error", err);
    }
  };

  // Annotation logic
  const handleStartAnnotation = async () => {
    if (!mediaStreamRef.current) return;
    try {
      await mediaStreamRef.current.startAnnotation();
      const annotationController =
        mediaStreamRef.current.getAnnotationController();
      // Set pen tool as default
      await annotationController.setToolType(1); // Pen
      await annotationController.setToolWidth(8);
      setIsAnnotating(true);
      setAnnotationError("");
    } catch (err) {
      setAnnotationError("Failed to start annotation.");
      setIsAnnotating(false);
    }
  };
  const stopAnnotation = async () => {
    if (!mediaStreamRef.current) return;
    try {
      await mediaStreamRef.current.stopAnnotation();
      setIsAnnotating(false);
    } catch (err) {
      setAnnotationError("Failed to stop annotation.");
    }
  };

  // Recording control functions (host only)
  const startRecording = async () => {
    if (!recordingClientRef.current) return;
    const res = await recordingClientRef.current.startCloudRecording();
    if (res === "") {
      setRecordingStatus("recording");
      setShowRecordingNotice(true);
    }
  };
  const pauseRecording = async () => {
    if (!recordingClientRef.current) return;
    const res = await recordingClientRef.current.pauseCloudRecording();
    if (res === "") setRecordingStatus("paused");
  };
  const resumeRecording = async () => {
    if (!recordingClientRef.current) return;
    const res = await recordingClientRef.current.resumeCloudRecording();
    if (res === "") setRecordingStatus("recording");
  };
  const stopRecording = async () => {
    if (!recordingClientRef.current) return;
    const res = await recordingClientRef.current.stopCloudRecording();
    if (res === "") {
      setRecordingStatus("stopped");
      setShowRecordingNotice(false);
    }
  };

  const handleEndMeeting = async () => {
    setShowEndMeetingConfirm(true);
  };
  const confirmEndMeeting = async () => {
    setShowEndMeetingConfirm(false);
    if (clientRef.current) {
      try {
        await clientRef.current.leave(true); // Host ends session for all
      } catch (err) {
        setError("Failed to end meeting for all.");
      }
    }
  };
  const handleLeave = async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.leave(); // Participant leaves session
      } catch (err) {
        setError("Failed to leave meeting.");
      }
    }
    navigate("/");
  };

  if (isJoining) return <div>Joining meeting...</div>;
  if (error)
    return (
      <div className="error-page">
        Error: {error} <button onClick={() => navigate("/")}>Go Back</button>
      </div>
    );

  return (
    <div className="meeting-container">
      <div className="top-bar">Zoom Meeting - {sessionName}</div>

      {/* Screen Share Containers */}
      {/* Replace the conditional rendering of the screen share container with always rendering it, but hide when not sharing */}
      <div
        className="screen-share-container"
        style={{ display: isSharingScreen ? "block" : "none" }}
      >
        <video
          ref={screenShareContainerRef}
          id="my-screen-share-content-video"
          style={{ width: "100%", height: "auto" }}
          autoPlay
          muted
        />
      </div>
      {isRemoteSharing && (
        <div className="remote-share-container">
          <canvas
            ref={remoteShareContainerRef}
            id="users-screen-share-content-canvas"
            style={{ width: "100%", height: "auto" }}
          />
        </div>
      )}

      {/* Notification toasts */}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 3000 }}>
        {notifications.map((n) => (
          <div
            key={n.id}
            style={{
              background: "#222",
              color: "#fff",
              padding: 12,
              borderRadius: 8,
              marginBottom: 8,
              boxShadow: "0 2px 8px #0006",
              minWidth: 220,
              position: "relative",
              opacity: 1,
              transition: "opacity 0.4s",
              animation: "fadeInOut 4s",
            }}
          >
            {n.msg}
            <button
              onClick={() =>
                setNotifications((prev) => prev.filter((x) => x.id !== n.id))
              }
              style={{
                position: "absolute",
                top: 4,
                right: 8,
                background: "none",
                border: "none",
                color: "#fff",
                fontSize: 16,
                cursor: "pointer",
              }}
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        ))}
        <style>{`
          @keyframes fadeInOut {
            0% { opacity: 0; transform: translateY(-10px); }
            10% { opacity: 1; transform: translateY(0); }
            90% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(-10px); }
          }
        `}</style>
      </div>

      {/* Video grid or sidebar */}
      {isSharingScreen ? (
        <div
          className={
            (isSharingScreen ? "video-sidebar" : "video-grid") +
            (participants.length === 1 && !isSharingScreen
              ? " single-participant"
              : "")
          }
        >
          {participants.map((user) => (
            <div
              className={
                "video-tile" +
                (activeSpeakerId &&
                user.userId === activeSpeakerId &&
                !isSharingScreen
                  ? " active-speaker"
                  : "")
              }
              key={user.userId}
            >
              <video-player-container
                ref={(el) => {
                  videoContainerRefs.current[user.userId] = el;
                  // Set aspect ratio if available
                  if (el && aspectRatioRefs.current[user.userId]) {
                    el.style.aspectRatio = aspectRatioRefs.current[user.userId];
                  }
                }}
              ></video-player-container>
              <div className="user-label">
                {user.displayName}
                {/* Network quality icon */}
                {networkQuality[user.userId] !== undefined && (
                  <FaSignal
                    style={{
                      marginLeft: 6,
                      color:
                        networkQuality[user.userId] >= 3
                          ? "#0f0"
                          : networkQuality[user.userId] === 2
                            ? "#ff0"
                            : "#f00",
                    }}
                    title={`Network: ${networkQuality[user.userId]}`}
                  />
                )}
                {(
                  user.userId === selfUserIdRef.current
                    ? isAudioOn
                    : user.bAudioOn
                ) ? (
                  <FaMicrophone
                    style={{ marginLeft: 6, color: "#0f0" }}
                    title="Mic On"
                  />
                ) : (
                  <FaMicrophoneSlash
                    style={{ marginLeft: 6, color: "#f00" }}
                    title="Mic Off"
                  />
                )}
                {(
                  user.userId === selfUserIdRef.current
                    ? isVideoOn
                    : user.bVideoOn
                ) ? (
                  <FaVideo
                    style={{ marginLeft: 6, color: "#0f0" }}
                    title="Camera On"
                  />
                ) : (
                  <FaVideoSlash
                    style={{ marginLeft: 6, color: "#f00" }}
                    title="Camera Off"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="video-grid">
          {participants.slice(0, 4).map((user) => (
            <div
              className={
                "video-tile" +
                (activeSpeakerId && user.userId === activeSpeakerId
                  ? " active-speaker"
                  : "")
              }
              key={user.userId}
            >
              <video-player-container
                ref={(el) => {
                  videoContainerRefs.current[user.userId] = el;
                  if (el && aspectRatioRefs.current[user.userId]) {
                    el.style.aspectRatio = aspectRatioRefs.current[user.userId];
                  }
                }}
              ></video-player-container>
              <div className="user-label">
                {user.displayName}
                {networkQuality[user.userId] !== undefined && (
                  <FaSignal
                    style={{
                      marginLeft: 6,
                      color:
                        networkQuality[user.userId] >= 3
                          ? "#0f0"
                          : networkQuality[user.userId] === 2
                            ? "#ff0"
                            : "#f00",
                    }}
                    title={`Network: ${networkQuality[user.userId]}`}
                  />
                )}
                {(
                  user.userId === selfUserIdRef.current
                    ? isAudioOn
                    : user.bAudioOn
                ) ? (
                  <FaMicrophone
                    style={{ marginLeft: 6, color: "#0f0" }}
                    title="Mic On"
                  />
                ) : (
                  <FaMicrophoneSlash
                    style={{ marginLeft: 6, color: "#f00" }}
                    title="Mic Off"
                  />
                )}
                {(
                  user.userId === selfUserIdRef.current
                    ? isVideoOn
                    : user.bVideoOn
                ) ? (
                  <FaVideo
                    style={{ marginLeft: 6, color: "#0f0" }}
                    title="Camera On"
                  />
                ) : (
                  <FaVideoSlash
                    style={{ marginLeft: 6, color: "#f00" }}
                    title="Camera Off"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showRecordingNotice && (
        <div className="recording-notice">
          <span className="recording-dot">●</span> This meeting is being
          recorded.
        </div>
      )}

      <div className="control-bar">
        {/* Mic button with dropdown for mic and speaker selection */}
        <div
          className="control-button video-control-group"
          style={{ position: "relative", marginRight: 8 }}
        >
          <button onClick={toggleAudio}>
            {isAudioOn ? <FaMicrophone /> : <FaMicrophoneSlash />}
          </button>
          <button
            className="video-options-toggle"
            onClick={() =>
              setShowVideoOptions(showVideoOptions === "mic" ? null : "mic")
            }
          >
            <FaChevronUp />
          </button>
          {showVideoOptions === "mic" && (
            <div
              className="video-options-menu"
              style={{ left: 0, minWidth: 200 }}
            >
              <label style={{ display: "block", marginBottom: 8 }}>
                Microphone:
                <select
                  value={selectedMic}
                  onChange={async (e) => {
                    setSelectedMic(e.target.value);
                    if (mediaStreamRef.current) {
                      await mediaStreamRef.current.switchMicrophone(
                        e.target.value
                      );
                    }
                  }}
                  style={{ width: "100%" }}
                >
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                Speaker:
                <select
                  value={selectedSpeaker}
                  onChange={async (e) => {
                    setSelectedSpeaker(e.target.value);
                    if (mediaStreamRef.current) {
                      await mediaStreamRef.current.switchSpeaker(
                        e.target.value
                      );
                    }
                  }}
                  style={{ width: "100%" }}
                >
                  {speakerDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        {/* Camera button with dropdown for camera and background selection */}
        <div
          className="control-button video-control-group"
          style={{ position: "relative", marginRight: 8 }}
        >
          <button onClick={toggleVideo}>
            {isVideoOn ? <FaVideo /> : <FaVideoSlash />}
          </button>
          <button
            className="video-options-toggle"
            onClick={() =>
              setShowVideoOptions(showVideoOptions === "video" ? null : "video")
            }
          >
            <FaChevronUp />
          </button>
          {showVideoOptions === "video" && (
            <div
              className="video-options-menu"
              style={{ left: 0, minWidth: 200 }}
            >
              <label style={{ display: "block", marginBottom: 8 }}>
                Camera:
                <select
                  value={selectedCamera}
                  onChange={async (e) => {
                    setSelectedCamera(e.target.value);
                    if (mediaStreamRef.current) {
                      await mediaStreamRef.current.switchCamera(e.target.value);
                    }
                  }}
                  style={{ width: "100%" }}
                >
                  {videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                Virtual Background:
                <select
                  value={bgMode}
                  onChange={handleBgChange}
                  style={{ width: "100%" }}
                >
                  <option value="none">None</option>
                  <option value="blur">Blur</option>
                  <option value="image">Image</option>
                </select>
              </label>
            </div>
          )}
        </div>
        {/* The rest of the control bar buttons remain unchanged */}
        <button
          className="control-button"
          onClick={() => handleModal("participants", true)}
        >
          <FaUsers />
        </button>
        <button
          className="control-button"
          onClick={() => handleModal("chat", true)}
        >
          <FaCommentDots />
        </button>
        {/* Screen Share Button */}
        <button className="control-button" onClick={handleScreenShare}>
          {isSharingScreen ? "Stop Share" : "Share Screen"}
        </button>
        {/* Annotation Button (only show if sharing or viewing share) */}
        {(isSharingScreen || isRemoteSharing) &&
          (isAnnotating ? (
            <button className="control-button" onClick={stopAnnotation}>
              Stop Annotation
            </button>
          ) : (
            <button className="control-button" onClick={handleStartAnnotation}>
              Annotate
            </button>
          ))}
        {isHost && (
          <>
            {recordingStatus === "stopped" && (
              <button className="control-button" onClick={startRecording}>
                Start Recording
              </button>
            )}
            {recordingStatus === "recording" && (
              <>
                <button className="control-button" onClick={pauseRecording}>
                  Pause Recording
                </button>
                <button className="control-button" onClick={stopRecording}>
                  Stop Recording
                </button>
              </>
            )}
            {recordingStatus === "paused" && (
              <>
                <button className="control-button" onClick={resumeRecording}>
                  Resume Recording
                </button>
                <button className="control-button" onClick={stopRecording}>
                  Stop Recording
                </button>
              </>
            )}
          </>
        )}
        {isHost ? (
          <button
            className="control-button leave"
            onClick={handleEndMeeting}
            style={{ background: "#e53935", color: "#fff" }}
          >
            <FaSignOutAlt /> End Meeting
          </button>
        ) : (
          <button className="control-button leave" onClick={handleLeave}>
            <FaSignOutAlt /> Leave
          </button>
        )}
      </div>
      {showModals.chat && (
        <div
          className="modal chat-modal"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            height: "100%",
            width: 340,
            background: "#fff",
            boxShadow: "-2px 0 12px #0002",
            zIndex: 2100,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid #e0e0e0",
            padding: 0,
            animation: "slideInRight 0.3s",
          }}
          onClick={() => handleModal("chat", false)}
        >
          <div
            className="modal-content"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: 0,
              background: "#f8f9fa",
              borderRadius: 0,
              boxShadow: "none",
              minWidth: 0,
              minHeight: 0,
              height: "100%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 24px 12px 24px",
                borderBottom: "1px solid #e0e0e0",
                background: "#fff",
              }}
            >
              <h3 style={{ margin: 0, fontWeight: 600, fontSize: 20 }}>Chat</h3>
              <button
                onClick={() => handleModal("chat", false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 22,
                  color: "#888",
                  cursor: "pointer",
                  marginLeft: 8,
                }}
                aria-label="Close chat panel"
              >
                ×
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 0 0 0",
                minHeight: 0,
              }}
            >
              {chatMessages.length === 0 ? (
                <div
                  style={{ color: "#888", textAlign: "center", marginTop: 32 }}
                >
                  No messages yet.
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      padding: "8px 24px 8px 24px",
                      fontSize: 15,
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        color: "#226",
                        minWidth: 60,
                        flexShrink: 0,
                        textAlign: "right",
                        marginRight: 8,
                      }}
                    >
                      {msg.sender}:
                    </div>
                    <div
                      style={{
                        color: "#222",
                        wordBreak: "break-word",
                        flex: 1,
                      }}
                    >
                      {msg.content}
                    </div>
                    <div
                      style={{
                        color: "#aaa",
                        fontSize: 12,
                        marginLeft: 8,
                        minWidth: 48,
                        textAlign: "right",
                      }}
                    >
                      {msg.timestamp}
                    </div>
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={sendChatMessage}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "18px 24px 18px 24px",
                borderTop: "1px solid #e0e0e0",
                background: "#fff",
                position: "relative",
              }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                style={{
                  padding: "10px 12px",
                  border: "1px solid #cfd8dc",
                  borderRadius: 8,
                  fontSize: 15,
                  outline: "none",
                  marginBottom: 0,
                  background: "#f8f9fa",
                  width: "100%",
                  boxSizing: "border-box",
                  color: "#222", // Ensure text is visible
                }}
                autoFocus
              />
              <button
                type="submit"
                style={{
                  background: "#1976f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 0",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                  transition: "background 0.2s",
                  marginTop: 0,
                  width: "100%",
                }}
              >
                Send
              </button>
            </form>
          </div>
          <style>{`
            @keyframes slideInRight {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
        </div>
      )}
      {showModals.participants && (
        <div
          className="modal participants-modal"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            height: "100%",
            width: 340,
            background: "#fff",
            boxShadow: "-2px 0 12px #0002",
            zIndex: 2000,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid #e0e0e0",
            padding: 0,
            animation: "slideInRight 0.3s",
          }}
          onClick={() => handleModal("participants", false)}
        >
          <div
            className="modal-content"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: 0,
              background: "#f8f9fa",
              borderRadius: 0,
              boxShadow: "none",
              minWidth: 0,
              minHeight: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 24px 12px 24px",
                borderBottom: "1px solid #e0e0e0",
                background: "#fff",
              }}
            >
              <h3 style={{ margin: 0, fontWeight: 600, fontSize: 20 }}>
                Participants ({participants.length})
              </h3>
              <button
                onClick={() => handleModal("participants", false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 22,
                  color: "#888",
                  cursor: "pointer",
                  marginLeft: 8,
                }}
                aria-label="Close participants panel"
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
              {participants.map((p, idx) => (
                <div
                  key={p.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: idx % 2 === 0 ? "#fff" : "#f3f4f6",
                    padding: "12px 24px",
                    borderBottom: "1px solid #f0f0f0",
                    fontSize: 16,
                    minHeight: 56,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "#e3e7ed",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      fontSize: 18,
                      color: "#3a3a3a",
                      marginRight: 16,
                      textTransform: "uppercase",
                    }}
                  >
                    {p.displayName?.[0] || "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontWeight: 500,
                        color: "#222",
                        fontSize: 16,
                        wordBreak: "break-all",
                      }}
                    >
                      {p.displayName}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginLeft: 12,
                    }}
                  >
                    {(
                      p.userId === selfUserIdRef.current
                        ? isAudioOn
                        : p.bAudioOn
                    ) ? (
                      <FaMicrophone
                        style={{ color: "#0f0", fontSize: 18 }}
                        title="Mic On"
                      />
                    ) : (
                      <FaMicrophoneSlash
                        style={{ color: "#f00", fontSize: 18 }}
                        title="Mic Off"
                      />
                    )}
                    {(
                      p.userId === selfUserIdRef.current
                        ? isVideoOn
                        : p.bVideoOn
                    ) ? (
                      <FaVideo
                        style={{ color: "#0f0", fontSize: 18 }}
                        title="Camera On"
                      />
                    ) : (
                      <FaVideoSlash
                        style={{ color: "#f00", fontSize: 18 }}
                        title="Camera Off"
                      />
                    )}
                    {networkQuality[p.userId] !== undefined && (
                      <FaSignal
                        style={{
                          color:
                            networkQuality[p.userId] >= 3
                              ? "#0f0"
                              : networkQuality[p.userId] === 2
                                ? "#ff0"
                                : "#f00",
                          fontSize: 18,
                        }}
                        title={`Network: ${networkQuality[p.userId]}`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <style>{`
            @keyframes slideInRight {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
        </div>
      )}
      {annotationError && <div className="error-page">{annotationError}</div>}
      {permissionError && (
        <div className="error-page">
          {permissionError}{" "}
          <button onClick={() => setPermissionError("")}>Dismiss</button>
        </div>
      )}
      {showEndMeetingConfirm && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.35)",
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: "32px 32px 24px 32px",
              boxShadow: "0 4px 24px #0002",
              minWidth: 320,
              maxWidth: "90vw",
              textAlign: "center",
            }}
          >
            <h2 style={{ margin: "0 0 18px 0", fontWeight: 700, fontSize: 22 }}>
              End Meeting?
            </h2>
            <div style={{ color: "#444", marginBottom: 28, fontSize: 16 }}>
              Are you sure you want to end the meeting for all participants?
            </div>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button
                onClick={() => setShowEndMeetingConfirm(false)}
                style={{
                  background: "#f5f5f5",
                  color: "#333",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmEndMeeting}
                style={{
                  background: "#e53935",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                End Meeting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingPage;
