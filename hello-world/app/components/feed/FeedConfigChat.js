"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

// N60 second chunk, Step D (AC2-C1, AC2-S6 UI half). The chat half of the
// Automation view's configuration surface: a free-text description of the
// jobs a person wants and how often to check for them, turned into a
// proposed configuration for DerivedConfigReview to show BEFORE anything is
// stored (app/api/feed-config/chat/route.js only proposes; it never writes).
//
// This component owns only the message text and the send action -- the
// derived config itself lives in useFeedConfigChat, one level up, so a
// second turn's result fully REPLACES what is shown for review rather than
// merging with the first (AC2-C1's membership clause).
export default function FeedConfigChat({ onSend, status }) {
  const [message, setMessage] = useState("");

  function handleSend() {
    const trimmed = message.trim();
    if (!trimmed || status === "loading") return;
    onSend(trimmed);
  }

  return (
    <Box sx={{ mb: 1.5 }}>
      <TextField
        fullWidth
        multiline
        minRows={2}
        size="small"
        placeholder="Describe the jobs you want and how often to check for them..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <Box sx={{ mt: 0.5, display: "flex", alignItems: "center", gap: 1 }}>
        <Button variant="outlined" size="small" disabled={status === "loading"} onClick={handleSend}>
          Preview configuration
        </Button>
        {status === "loading" && (
          <Typography sx={{ color: "text.secondary", fontSize: "0.78rem" }}>
            Reading your message...
          </Typography>
        )}
      </Box>
      {status === "limited" && (
        <Typography sx={{ color: "warning.main", fontSize: "0.78rem", mt: 0.5 }}>
          Too many messages. Try again in a few minutes.
        </Typography>
      )}
      {status === "error" && (
        <Typography sx={{ color: "error.main", fontSize: "0.78rem", mt: 0.5 }}>
          Something went wrong deriving that configuration. Try rephrasing your message.
        </Typography>
      )}
    </Box>
  );
}
