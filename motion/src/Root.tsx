import { Composition } from "remotion";
import { Film } from "./engine/Film";
import { timeline } from "./engine/spec";
import { canvas } from "./design/tokens";
import { videos } from "./videos";

export function Root() {
  return (
    <>
      {videos.map((spec) => (
        <Composition
          key={spec.id}
          id={spec.id}
          component={Film}
          defaultProps={{ spec }}
          durationInFrames={timeline(spec, canvas.fps).durationInFrames}
          fps={canvas.fps}
          width={canvas.width}
          height={canvas.height}
        />
      ))}
    </>
  );
}
