import { keccak256, toUtf8Bytes } from "ethers";

export const qrHash = (text: string): string => keccak256(toUtf8Bytes(text.trim()));
