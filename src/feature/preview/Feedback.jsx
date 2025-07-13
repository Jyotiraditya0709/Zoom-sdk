import React, { useState } from "react";

const Feedback = () => {
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    // Optionally send feedback to backend here
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#232323",
        color: "#fff",
      }}
    >
      {!submitted ? (
        <form
          onSubmit={handleSubmit}
          style={{
            width: 350,
            background: "#2d2d2d",
            padding: 32,
            borderRadius: 12,
            boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
          }}
        >
          <h2 style={{ marginBottom: 16 }}>Thank you for attending!</h2>
          <label
            htmlFor="feedback"
            style={{ display: "block", marginBottom: 8 }}
          >
            We value your feedback:
          </label>
          <textarea
            id="feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={5}
            style={{
              width: "100%",
              borderRadius: 8,
              border: "none",
              padding: 10,
              marginBottom: 16,
              resize: "vertical",
            }}
            placeholder="Share your thoughts..."
            required
          />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              border: "none",
              background: "#00baff",
              color: "#fff",
              fontWeight: "bold",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Submit Feedback
          </button>
        </form>
      ) : (
        <div
          style={{
            background: "#2d2d2d",
            padding: 32,
            borderRadius: 12,
            boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
          }}
        >
          <h2>Thank you for your feedback!</h2>
          <p>We appreciate your input.</p>
        </div>
      )}
    </div>
  );
};

export default Feedback;
