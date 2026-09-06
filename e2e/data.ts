export const E2E_USERS = {
  admin: {
    id: uuid(101),
    email: "admin@example.test",
    displayName: "测试管理员",
  },
  author: {
    id: uuid(102),
    email: "author@example.test",
    displayName: "测试作者",
  },
  reader: {
    id: uuid(103),
    email: "reader@example.test",
    displayName: "测试读者",
  },
  outsider: {
    id: uuid(104),
    email: "outsider@example.test",
    displayName: "新成员",
  },
} as const;

export const E2E_POSTS = {
  discussion: post(201, 1201, "讨论行为测试"),
  annotationCreation: post(203, 1203, "批注创建行为测试"),
  annotationActivation: post(204, 1204, "批注激活行为测试"),
  imported: post(205, 1205, "DOCX 导入编辑测试"),
  deleteRestore: post(206, 1206, "帖子删除恢复测试"),
  hidden: post(207, 1207, "管理员隐藏行为测试"),
  revision: post(208, 1208, "历史版本恢复测试"),
  conflict: post(209, 1209, "并发编辑行为测试"),
  purge: post(210, 1210, "管理员永久删除测试"),
  edit: post(211, 1211, "帖子编辑行为测试"),
  replyFailure: post(212, 1212, "回复失败恢复测试"),
  annotationDiscussion: post(213, 1213, "批注讨论行为测试"),
  annotationEdit: post(214, 1214, "批注端点保护测试"),
  bulkOne: post(215, 1215, "批量管理目标一"),
  bulkTwo: post(216, 1216, "批量管理目标二"),
} as const;

export const E2E_ANNOTATIONS = {
  activation: `ann_${uuid(501)}`,
  imported: `ann_${uuid(502)}`,
  discussion: `ann_${uuid(503)}`,
  edit: `ann_${uuid(504)}`,
} as const;

export const E2E_ANNOTATION_REPLIES = {
  discussion: uuid(551),
  imported: uuid(552),
} as const;

export const E2E_IMPORT_BATCH = uuid(901);

export const E2E_TAG = {
  id: uuid(801),
  name: "行为测试",
  normalizedName: "行为测试",
} as const;

export const E2E_DISCOVERY_POSTS = Array.from({ length: 25 }, (_, index) => ({
  ...post(300 + index, 1300 + index, `分页行为 ${String(index + 1).padStart(2, "0")}`),
  index,
}));

export function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function post(id: number, revisionId: number, title: string) {
  return { id: uuid(id), revisionId: uuid(revisionId), title };
}
