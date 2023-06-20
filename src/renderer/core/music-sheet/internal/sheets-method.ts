import {
  localPluginName,
  sortIndexSymbol,
  timeStampSymbol,
} from "@/common/constant";
import { nanoid } from "nanoid";
import musicSheetDB from "./db";
import { musicSheetsStore } from "./store";
import { produce } from "immer";
import defaultSheet from "./default-sheet";
import { getMediaPrimaryKey, isSameMedia } from "@/common/media-util";
import { useEffect, useState } from "react";

// 默认歌单，快速判定是否在列表中
const favoriteMusicListIds = new Set<string>();

export async function initSheets() {
  try {
    const allSheets = await musicSheetDB.sheets.toArray();
    if (
      allSheets.length === 0 ||
      allSheets.findIndex((item) => item.id === defaultSheet.id) === -1
    ) {
      await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        async () => {
          musicSheetDB.sheets.put(defaultSheet);
        }
      );
      musicSheetsStore.setValue([defaultSheet, ...allSheets]);
    } else {
      musicSheetsStore.setValue(allSheets);
    }
  } catch (e) {
    console.log(e);
  }
}

// 添加新歌单
export async function addSheet(sheetName: string) {
  const id = nanoid();
  const newSheet: IMusic.IMusicSheetItem = {
    id,
    title: sheetName,
    createAt: Date.now(),
    platform: localPluginName,
    musicList: [],
  };
  try {
    await musicSheetDB.transaction(
      "readwrite",
      musicSheetDB.sheets,
      async () => {
        musicSheetDB.sheets.put(newSheet);
      }
    );
    musicSheetsStore.setValue((prev) => [...prev, newSheet]);
  } catch {
    throw new Error("新建失败");
  }
}

export async function getAllSheets() {
  try {
    const allSheets = await musicSheetDB.sheets.toArray();
    musicSheetsStore.setValue(allSheets);
  } catch (e) {
    console.log(e);
  }
}

/** 更新 */
export async function updateSheet(
  sheetId: string,
  newData: IMusic.IMusicSheetItem
) {
  try {
    if (!newData) {
      return;
    }
    await musicSheetDB.transaction(
      "readwrite",
      musicSheetDB.sheets,
      async () => {
        musicSheetDB.sheets.update(sheetId, newData);
      }
    );
    musicSheetsStore.setValue(
      produce((draft) => {
        const currentIndex = musicSheetsStore
          .getValue()
          .findIndex((_) => _.id === sheetId);
        if (currentIndex === -1) {
          draft.push(newData);
        } else {
          draft[currentIndex] = {
            ...draft[currentIndex],
            ...newData,
          };
        }
      })
    );
  } catch (e) {
    console.log(e);
  }
}

export async function removeSheet(sheetId: string) {
  try {
    if (sheetId === defaultSheet.id) {
      return;
    }
    await musicSheetDB.transaction(
      "readwrite",
      musicSheetDB.sheets,
      async () => {
        musicSheetDB.sheets.delete(sheetId);
      }
    );
    musicSheetsStore.setValue((prev) =>
      prev.filter((item) => item.id !== sheetId)
    );
  } catch (e) {
    console.log(e);
  }
}

/************* 歌曲 ************/
export async function addMusicToSheet(
  musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
  sheetId: string
) {
  const _musicItems = Array.isArray(musicItems) ? musicItems : [musicItems];
  try {
    // 当前的列表
    const targetSheet = musicSheetsStore
      .getValue()
      .find((item) => item.id === sheetId);
    if (!targetSheet) {
      return;
    }
    // 筛选出不在列表中的项目
    const targetMusicList = targetSheet.musicList;
    const validMusicItems = _musicItems.filter(
      (item) => -1 === targetMusicList.findIndex((mi) => isSameMedia(mi, item))
    );

    await musicSheetDB.transaction(
      "rw",
      musicSheetDB.musicStore,
      musicSheetDB.sheets,
      async () => {
        // 寻找已入库的音乐项目
        const allMusic = await musicSheetDB.musicStore.bulkGet(
          validMusicItems.map((item) => [item.platform, item.id])
        );
        allMusic.forEach((mi, index) => {
          if (mi) {
            mi.$$ref += 1;
          } else {
            allMusic[index] = {
              ...validMusicItems[index],
              $$ref: 1,
            };
          }
        });
        await musicSheetDB.musicStore.bulkPut(allMusic);
        const timeStamp = Date.now();
        await musicSheetDB.sheets
          .where("id")
          .equals(sheetId)
          .modify((obj) => {
            obj.musicList = [
              ...(obj.musicList ?? []),
              ...validMusicItems.map((item, index) => ({
                platform: item.platform,
                id: item.id,
                [sortIndexSymbol]: index,
                [timeStampSymbol]: timeStamp,
              })),
            ];
            targetSheet.musicList = obj.musicList;
          });
      }
    );

    if (sheetId === defaultSheet.id) {
      _musicItems.forEach((mi) => {
        favoriteMusicListIds.add(getMediaPrimaryKey(mi));
      });
      refreshFavoriteState();
    }
    refreshSheetState(sheetId);
  } catch {
    console.log("error!!");
  }
}

export async function getSheetDetail(
  sheetId: string
): Promise<IMusic.IMusicSheetItem | null> {
  return await musicSheetDB.transaction(
    "readonly",
    musicSheetDB.musicStore,
    async () => {
      const targetSheet = musicSheetsStore
        .getValue()
        .find((item) => item.id === sheetId);
      if (!targetSheet) {
        return null;
      }
      const musicList = targetSheet.musicList ?? [];
      const musicDetailList = await musicSheetDB.musicStore.bulkGet(
        musicList.map((item) => [item.platform, item.id])
      );
      const _targetSheet = { ...targetSheet };
      _targetSheet.musicList = musicList.map((mi, index) => ({
        ...mi,
        ...musicDetailList[index],
      }));
      console.log(_targetSheet)
      return _targetSheet as IMusic.IMusicSheetItem;
    }
  );
}

export async function removeMusicFromSheet(
  musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
  sheetId: string
) {
  const _musicItems = Array.isArray(musicItems) ? musicItems : [musicItems];
  const targetSheet = musicSheetsStore
    .getValue()
    .find((item) => item.id === sheetId);
  if (!targetSheet) {
    return;
  }
  const targetMusicList = targetSheet.musicList ?? [];
  const toBeRemovedMusic: IMedia.IMediaBase[] = [];
  const restMusic: IMedia.IMediaBase[] = [];
  for (const mi of targetMusicList) {
    // 用map会更快吧
    if (_musicItems.findIndex((item) => isSameMedia(mi, item)) === -1) {
      restMusic.push(mi);
    } else {
      toBeRemovedMusic.push(mi);
    }
  }

  try {
    await musicSheetDB.transaction(
      "rw",
      musicSheetDB.sheets,
      musicSheetDB.musicStore,
      async () => {
        // 寻找引用
        const toBeRemovedMusicDetail = await musicSheetDB.musicStore.bulkGet(
          toBeRemovedMusic.map((item) => [item.platform, item.id])
        );
        const needDelete: any[] = [];
        const needUpdate: any[] = [];
        toBeRemovedMusicDetail.forEach((musicItem) => {
          musicItem.$$ref--;
          if (musicItem.$$ref === 0) {
            needDelete.push([musicItem.platform, musicItem.id]);
          } else {
            needUpdate.push(musicItem);
          }
        });
        console.log(needDelete);
        await musicSheetDB.musicStore.bulkDelete(needDelete);
        await musicSheetDB.musicStore.bulkPut(needUpdate);

        await musicSheetDB.sheets
          .where("id")
          .equals(sheetId)
          .modify((obj) => {
            obj.musicList = restMusic;
            targetSheet.musicList = obj.musicList;
          });
      }
    );

    if (sheetId === defaultSheet.id) {
      toBeRemovedMusic.forEach((mi) => {
        favoriteMusicListIds.delete(getMediaPrimaryKey(mi));
      });
      refreshFavoriteState();
    }
    refreshSheetState(sheetId);
  } catch {
    console.log("error")
  }
}

const refreshFavCbs = new Set<() => void>();
function refreshFavoriteState() {
  refreshFavCbs.forEach((cb) => cb?.());
}

export function useMusicIsFavorite(musicItem: IMusic.IMusicItem) {
  const [isFav, setIsFav] = useState(
    favoriteMusicListIds.has(getMediaPrimaryKey(musicItem))
  );

  useEffect(() => {
    const cb = () => {
      setIsFav(favoriteMusicListIds.has(getMediaPrimaryKey(musicItem)));
    };
    if (musicItem) {
      refreshFavCbs.add(cb);
    }
    return () => {
      refreshFavCbs.delete(cb);
    };
  }, [musicItem]);

  return isFav;
}

export async function addMusicToFavorite(
  musicItems: IMusic.IMusicItem | IMusic.IMusicItem[]
) {
  return addMusicToSheet(musicItems, defaultSheet.id);
}

export async function removeMusicFromFavorite(
  musicItems: IMusic.IMusicItem | IMusic.IMusicItem[]
) {
  return removeMusicFromSheet(musicItems, defaultSheet.id);
}

export async function isFavoriteMusic(musicItem: IMusic.IMusicItem) {
  return favoriteMusicListIds.has(getMediaPrimaryKey(musicItem));
}

const updateSheetCbs: Map<string, Set<() => void>> = new Map();
function refreshSheetState(sheetId: string) {
  updateSheetCbs.get(sheetId)?.forEach((cb) => cb?.());
}

export function useMusicSheet(sheetId: string) {
  const [musicSheet, setMusicSheet] = useState<IMusic.IMusicSheetItem | null>(
    null
  );

  useEffect(() => {
    const updateSheet = () => {
      getSheetDetail(sheetId).then(setMusicSheet);
    };
    updateSheet();
    const cbs = updateSheetCbs.get(sheetId) ?? new Set();
    cbs.add(updateSheet);
    updateSheetCbs.set(sheetId, cbs);
    return () => {
      cbs?.delete(updateSheet);
    };
  }, [sheetId]);

  return musicSheet;
}