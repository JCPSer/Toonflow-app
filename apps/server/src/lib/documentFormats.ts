// ACT: 纯契约已下沉到 @toonflow/formats；此处保留旧路径再导出，冻结 @toonflow/server/documentFormats 的公开面。
export {
  decodeTextFile, documentAccept, documentFormats, getDocumentExtension, getDocumentMimeType,
  getReadableFileExtension, getReadableFileMimeType, getTextMimeType, readableFileAccept, textFormats,
} from "@toonflow/formats/documentFormats";
