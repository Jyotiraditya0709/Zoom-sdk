import React, { useEffect, useState, useRef } from "react";
import ZoomVideo from "@zoom/videosdk";
import { useNavigate } from "react-router-dom";
import "./Preview.css";
const VirtualBackgroundType = ZoomVideo;

const Preview = () => {
  const videoRef = useRef(null);
  const navigate = useNavigate();

  // ========== State for selected options ==========
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [speakerDevices, setSpeakerDevices] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMic, setSelectedMic] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState("");
  const [bgMode, setBgMode] = useState("none");

  const client = useRef(null);
  const localVideoTrack = useRef(null);
  const localAudioTrack = useRef(null);

  //========== Fetch Devices on Mount ==========
  useEffect(() => {
    const fetchDevices = async () => {
      const devices = await ZoomVideo.getDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      const mics = devices.filter((d) => d.kind == "audioinput");
      const speakers = devices.filter((d) => d.kind === "audiooutput");

      setVideoDevices(cams);
      setAudioDevices(mics);
      setSpeakerDevices(speakers);
      setSelectedCamera(cams[0]?.deviceId);
      setSelectedMic(mics[0]?.deviceId);
      setSelectedSpeaker(speakers[0]?.deviceId);
    };

    fetchDevices();
  }, []);

  // ========== Start Preview Camera and Mic with Optional Background ==========
  const startPreview = async () => {
    client.current = ZoomVideo.createClient();

    await client.current.init("en-US", "Global", { patchJsMedia: true });

    //create and store local vid/aud tracks
    localVideoTrack.current = ZoomVideo.createLocalVideoTrack(selectedCamera);
    if (bgMode === "blur") {
      await localVideoTrack.current.start(videoRef.current, {
        virtualBackground: {
          type: ZoomVideo.VirtualBackgroundType.Blur,
        },
      });
    } else if (bgMode === "image") {
      await localVideoTrack.current.start(videoRef.current, {
        virtualBackground: {
          type: ZoomVideo.VirtualBackgroundType.Image,
          source: "url-to-your-image.jpg", // or imported image path
        },
      });
    } else {
      await localVideoTrack.current.start(videoRef.current);
    }

    localAudioTrack.current = ZoomVideo.createLocalAudioTrack(selectedMic);

    await localAudioTrack.current.start();
    await localAudioTrack.current.unmute();
  };

  useEffect(() => {
    if (selectedCamera && selectedMic) {
      startPreview();
    }
  }, [selectedCamera, selectedMic, bgMode]);

  // ========== Join Meeting Handler ==========
  const handleJoin = () => {
    navigate("/meeting", {
      state: {
        client: client.current,
        camera: selectedCamera,
        mic: selectedMic,
        speaker: selectedSpeaker,
      },
    });
  };
  // ========== Mic Testing Feature ==========
  let microPhoneTester;
  const handleMicTest = () => {
    const levelElm = document.querySelector("#mic-input-level");
    if (microPhoneTester) {
      microPhoneTester.stop();
      microPhoneTester = null;
      return;
    }

    //volume level monitoring
    microPhoneTester = localAudioTrack.current.testMicrophone({
      microphoneId: selectedMic,
      speakerId: selectedSpeaker,
      recordAndPlay: true,
      onAnalyseFrequency: (v) => {
        levelElm.value = v;
      },
      onStartRecording: () => {},
      onStartPlayRecording: () => {},
      onStopPlayRecording: () => {
        microPhoneTester = null;
      },
    });
  };

  // ========== Speaker Test ==========
  let speakerTester;
  const handleSpeakerTest = () => {
    const levelElm = document.querySelector("#speaker-output-level");

    //if running, destroy
    if (speakerTester) {
      speakerTester.destroy();
      speakerTester = null;
      return;
    }

    speakerTester = localAudioTrack.current.testSpeaker({
      speakerId: selectedSpeaker,
      onAnalyseFrequency: (v) => {
        levelElm.value = v;
      },
    });
  };

  return (
    <div className="preview-page">
      <div className="preview-container">
        <div className="video-preview">
          <video ref={videoRef} autoPlay muted playsInline></video>
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
            Virtual Background:
            <select value={bgMode} onChange={(e) => setBgMode(e.target.value)}>
              <option value="none">None</option>
              <option value="blur">Blur</option>
              <option value="image">Image</option>
            </select>
          </label>

          <button className="join-button" onClick={handleJoin}>
            Ask to join
          </button>
        </div>
      </div>
    </div>
  );
};

export default Preview;
