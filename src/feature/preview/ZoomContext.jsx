import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
} from "react";
import ZoomVideo from "@zoom/videosdk";

const ZoomContext = createContext();
export const useZoom = () => useContext(ZoomContext);

export const ZoomProvider = ({ children }) => {
  const client = useRef(null);
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMic, setSelectedMic] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState("");
  const [userName, setUserName] = useState("Guest");
  const [sessionName, setSessionName] = useState("meeting-test");
  // Add bgMode to context
  const [bgMode, setBgMode] = useState("none");

  // Create or reuse client
  const getClient = useCallback(() => {
    if (!client.current) {
      client.current = ZoomVideo.createClient();
    }
    return client.current;
  }, []);

  // Clean up all tracks and client
  const cleanup = useCallback(async () => {
    if (localVideoTrack) {
      await localVideoTrack.stop();
      setLocalVideoTrack(null);
    }
    if (localAudioTrack) {
      await localAudioTrack.stop();
      setLocalAudioTrack(null);
    }
    if (client.current) {
      try {
        await client.current.leave();
      } catch {}
      client.current = null;
    }
  }, [localVideoTrack, localAudioTrack]);

  return (
    <ZoomContext.Provider
      value={{
        client,
        getClient,
        localVideoTrack,
        setLocalVideoTrack,
        localAudioTrack,
        setLocalAudioTrack,
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
        cleanup,
        // Add bgMode to context value
        bgMode,
        setBgMode,
      }}
    >
      {children}
    </ZoomContext.Provider>
  );
};
