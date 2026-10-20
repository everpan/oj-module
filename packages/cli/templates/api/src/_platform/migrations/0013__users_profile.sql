-- 个人中心资料字段：phone_number/description 可空列——「我的资料」表单
-- POST /api/personal-center/profile 入库用；可空先例同 0007（email）。
ALTER TABLE users ADD COLUMN phone_number TEXT;
ALTER TABLE users ADD COLUMN description TEXT;
