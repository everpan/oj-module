export interface NotificationItem {
    /** 必填——单条已读/清空等写操作的前提（G4，破坏性变更，发版说明标注） */
    id: string | number;
    avatar: string;
    date: string;
    isRead?: boolean;
    message: string;
    title: string;
}
