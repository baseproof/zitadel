"use client";

import { createContext, ReactNode, useContext } from "react";

const SaveDataContext = createContext(false);

/**
 * Whether the request asked to save data: the browser's or the operating
 * system's data saver sends `Save-Data: on` on every request. The root layout
 * reads the header; the branding leaves its font out when it is on.
 */
export function SaveDataProvider({ saveData, children }: { saveData: boolean; children: ReactNode }) {
  return <SaveDataContext.Provider value={saveData}>{children}</SaveDataContext.Provider>;
}

export function useSaveData(): boolean {
  return useContext(SaveDataContext);
}
