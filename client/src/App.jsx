import { useCallback, useState } from "react";
import Landing from "./pages/Landing.jsx";
import DeviceSetup from "./pages/DeviceSetup.jsx";
import CallRoom from "./pages/CallRoom.jsx";
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
  const [isHost, setIsHost] = useState(() => sessionStorage.getItem("isHost") === "1");
  const [selectedDevices, setSelectedDevices] = useState({
    videoDeviceId: "",
    audioDeviceId: "",
    speakerDeviceId: "",
  });

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

  function goToSetup(id, host) {
    const asHost = Boolean(host);
    setIsHost(asHost);
    sessionStorage.setItem("isHost", asHost ? "1" : "0");
    setRoomInUrl(id);
    setScreen("setup");
  }

  function goToLanding() {
    setScreen("landing");
  }

  function joinCall(stream) {
    // Free the camera so the meeting can use it.
    stopStream(stream);
    setScreen("call");
  }

  function leaveCall() {
    setScreen("landing");
  }

  if (screen === "setup") {
    return (
      <DeviceSetup
        displayName={displayName}
        roomId={roomId}
        isHost={isHost}
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
        isHost={isHost}
        selectedDevices={selectedDevices}
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
