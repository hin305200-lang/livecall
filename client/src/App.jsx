import { useCallback, useEffect, useState } from "react";
import Landing from "./pages/Landing.jsx";
import DeviceSetup from "./pages/DeviceSetup.jsx";
import CallRoom from "./pages/CallRoom.jsx";
import { getSocket } from "./lib/socket.js";
import { stopStream } from "./lib/media.js";

function roomFromUrl() {
  return (new URLSearchParams(window.location.search).get("room") || "").toUpperCase();
}

export default function App() {
  const [screen, setScreen] = useState("landing");
  const [displayName, setDisplayName] = useState(
    () => sessionStorage.getItem("displayName") || ""
  );
  const [roomId, setRoomId] = useState(roomFromUrl);
  const [selectedDevices, setSelectedDevices] = useState({
    videoDeviceId: "",
    audioDeviceId: "",
    speakerDeviceId: "",
  });
  const [localStream, setLocalStream] = useState(null);

  useEffect(() => {
    getSocket();
  }, []);

  const persistName = useCallback((name) => {
    setDisplayName(name);
    sessionStorage.setItem("displayName", name);
  }, []);

  const setRoomInUrl = useCallback((id) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("room", id);
    else url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
    setRoomId(id);
  }, []);

  function goToSetup(id) {
    setRoomInUrl(id);
    setScreen("setup");
  }

  function goToLanding() {
    stopStream(localStream);
    setLocalStream(null);
    setScreen("landing");
  }

  function joinCall(stream) {
    setLocalStream(stream);
    setScreen("call");
  }

  function leaveCall() {
    stopStream(localStream);
    setLocalStream(null);
    setScreen("landing");
  }

  if (screen === "setup") {
    return (
      <DeviceSetup
        displayName={displayName}
        roomId={roomId}
        selectedDevices={selectedDevices}
        onSelectedDevices={setSelectedDevices}
        onBack={goToLanding}
        onJoin={joinCall}
      />
    );
  }

  if (screen === "call") {
    return (
      <CallRoom
        displayName={displayName}
        roomId={roomId}
        localStream={localStream}
        selectedDevices={selectedDevices}
        onSelectedDevices={setSelectedDevices}
        onLeave={leaveCall}
      />
    );
  }

  return (
    <Landing
      displayName={displayName}
      onDisplayName={persistName}
      initialRoomId={roomId}
      onReady={goToSetup}
    />
  );
}
