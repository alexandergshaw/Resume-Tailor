"use client";

import { useState } from "react";
import { fetchGmailInboxPage } from "./gmailInbox";

/**
 * Custom hook that owns all Gmail inbox state and exposes handlers.
 * Keeps page.js free of Gmail-specific logic.
 *
 * @param {object[]} applicationData - the user's tracked applications (needs `company` field)
 */
export function useGmailInbox(applicationData) {
  const [gmailAnchorEl, setGmailAnchorEl] = useState(null);
  const [gmailMessages, setGmailMessages] = useState([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailNextPageToken, setGmailNextPageToken] = useState(null);
  const [gmailLoadingMore, setGmailLoadingMore] = useState(false);

  function companyNames() {
    return [...new Set(applicationData.map((a) => a.company).filter(Boolean))];
  }

  async function handleOpenGmailMenu(e) {
    setGmailAnchorEl(e.currentTarget);
    if (gmailMessages.length > 0) return; // served from state; user can Refresh to reload
    setGmailLoading(true);
    try {
      const { matched, nextPageToken } = await fetchGmailInboxPage({
        companyNames: companyNames(),
        applications: applicationData,
      });
      setGmailMessages(matched);
      setGmailNextPageToken(nextPageToken);
    } catch {}
    setGmailLoading(false);
  }

  async function handleRefreshGmail() {
    setGmailMessages([]);
    setGmailNextPageToken(null);
    setGmailLoading(true);
    try {
      const { matched, nextPageToken } = await fetchGmailInboxPage({
        companyNames: companyNames(),
        applications: applicationData,
        force: true,
      });
      setGmailMessages(matched);
      setGmailNextPageToken(nextPageToken);
    } catch {}
    setGmailLoading(false);
  }

  async function handleLoadMoreGmail() {
    if (!gmailNextPageToken || gmailLoadingMore) return;
    setGmailLoadingMore(true);
    try {
      const { matched, nextPageToken } = await fetchGmailInboxPage({
        companyNames: companyNames(),
        applications: applicationData,
        pageToken: gmailNextPageToken,
      });
      setGmailMessages((prev) => [...prev, ...matched]);
      setGmailNextPageToken(nextPageToken);
    } catch {}
    setGmailLoadingMore(false);
  }

  return {
    gmailAnchorEl,
    setGmailAnchorEl,
    gmailMessages,
    gmailLoading,
    gmailNextPageToken,
    gmailLoadingMore,
    handleOpenGmailMenu,
    handleRefreshGmail,
    handleLoadMoreGmail,
  };
}
