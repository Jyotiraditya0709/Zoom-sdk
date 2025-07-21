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
            console.error("Failed to start self video", e);
            setError("Could not start camera. Check permissions.");
          }

          // Attach videos for users already in the session
          client.getAllUser().forEach(async (user) => {
            if (user.bVideoOn && user.userId !== selfUserIdRef.current) {
              await attachVideo(user.userId);
            }
          });
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

    return () => {
      if (clientRef.current) {
        clientRef.current.leave();
      }
      zoomCleanup();
    };
  }, []);

  const toggleAudio = useCallback(async () => {
    if (mediaStreamRef.current) {
      if (isAudioOn) await mediaStreamRef.current.muteAudio();
      else await mediaStreamRef.current.unmuteAudio();
      setIsAudioOn(!isAudioOn);
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
      <div className="video-grid">
        {participants.map((user) => (
          <div className="video-tile" key={user.userId}>
            <video-player-container
              ref={(el) => (videoContainerRefs.current[user.userId] = el)}
            ></video-player-container>
            <div className="user-label">{user.displayName}</div>
          </div>
        ))}
      </div>
      <div className="control-bar">
        <button onClick={toggleAudio}>
          {isAudioOn ? <FaMicrophone /> : <FaMicrophoneSlash />}
        </button>
        <button onClick={toggleVideo}>
          {isVideoOn ? <FaVideo /> : <FaVideoSlash />}
        </button>
        <button onClick={() => handleModal("participants", true)}>
          <FaUsers />
        </button>
        <select value={bgMode} onChange={handleBgChange}>
          <option value="none">No BG</option>
          <option value="blur">Blur</option>
          <option value="image">Image</option>
        </select>
        <button onClick={() => handleModal("chat", true)}>
          <FaCommentDots />
        </button>
        <button className="leave" onClick={() => navigate("/")}>
          <FaSignOutAlt /> Leave
        </button>
      </div>
      {showModals.chat && (
        <div className="modal" onClick={() => handleModal("chat", false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Chat</h3>
            <div className="chat-messages">
              {chatMessages.map((msg, i) => (
                <div key={i}>
                  <strong>{msg.sender}:</strong> {msg.content}
                </div>
              ))}
            </div>
            <form onSubmit={sendChatMessage}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                autoFocus
              />
              <button type="submit">Send</button>
            </form>
          </div>
        </div>
      )}
      {showModals.participants && (
        <div
          className="modal"
          onClick={() => handleModal("participants", false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Participants ({participants.length})</h3>
            <ul>
              {participants.map((p) => (
                <li key={p.userId}>{p.displayName}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingPage;
