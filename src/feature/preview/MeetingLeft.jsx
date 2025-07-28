import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./MeetingLeft.css";

const MeetingLeft = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Show the screen for 2 seconds, then redirect to preview page
    const timer = setTimeout(() => {
      navigate("/");
    }, 500);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="meeting-left-container">
      <div className="meeting-left-content">
        <div className="meeting-left-text">You've left the meeting</div>
        <div className="meeting-left-subtext">Returning to home screen</div>
      </div>
    </div>
  );
};

export default MeetingLeft;
