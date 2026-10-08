import type { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/* One live photo from the open camera, resized to 1600 px JPEG like the site's camera.
   The heavy haptic fires first so the shutter feels instant. */
export async function snap(camera: CameraView) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  const pic = await camera.takePictureAsync({ quality: 0.8 });
  const takenAt = new Date().toISOString();
  const img = await ImageManipulator.manipulate(pic.uri)
    .resize(pic.width >= pic.height ? { width: 1600 } : { height: 1600 })
    .renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return { uri: out.uri, takenAt };
}
