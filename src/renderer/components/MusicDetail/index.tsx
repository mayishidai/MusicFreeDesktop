import Evt from "@renderer/core/events";
import AnimatedDiv from "../AnimatedDiv";
import "./index.scss";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { useCurrentMusic } from "@/renderer/core/track-player/player";
import Store from "@/common/store";
import Tag from "../Tag";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import Lyric from "./widgets/Lyric";
import SvgAsset from "../SvgAsset";
import { OptionItem } from "./widgets/OptionItem";

export const musicDetailShownStore = new Store(false);

export const isMusicDetailShown = musicDetailShownStore.getValue;

export default function () {
  const musicItem = useCurrentMusic();
  const musicDetailShown = musicDetailShownStore.useValue();

  Evt.use("SHOW_MUSIC_DETAIL", () => {
    musicDetailShownStore.setValue(true);
  });

  Evt.use("HIDE_MUSIC_DETAIL", () => {
    musicDetailShownStore.setValue(false);
  });

  return (
    <AnimatedDiv
      showIf={musicDetailShown}
      className="music-detail-container animate__animated background-color"
      mountClassName="animate__slideInUp"
      unmountClassName="animate__slideOutDown"
    >
      <div
        className="music-detail-background"
        style={{
          backgroundImage: `url(${musicItem?.artwork ?? albumImg})`,
        }}
      ></div>
      <div
        className="hide-music-detail"
        role="button"
        title="关闭歌曲详情页"
        onClick={() => {
          musicDetailShownStore.setValue(false);
        }}
      >
        <SvgAsset iconName="chevron-down"></SvgAsset>
      </div>
      <div className="music-title" title={musicItem?.title}>
        {musicItem?.title}
      </div>
      <div className="music-info">
        <span>
          {musicItem?.artist} - {musicItem?.album}
        </span>
        <Tag fill>{musicItem?.platform}</Tag>
      </div>
      <div className="music-body">
        <div className="music-album-options">
          <img
            className="music-album"
            onError={setFallbackAlbum}
            src={musicItem?.artwork ?? albumImg}
          ></img>
          {/* <div className="music-options">
            <OptionItem iconName='document-plus'></OptionItem>
          </div> */}
        </div>

        <Lyric></Lyric>
      </div>
    </AnimatedDiv>
  );
}


