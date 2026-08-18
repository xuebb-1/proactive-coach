-- CreateTable
CREATE TABLE "Meal" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kcal" INTEGER NOT NULL,
    "tags" TEXT[],
    "mode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meal_key_key" ON "Meal"("key");

-- CreateIndex
CREATE INDEX "Meal_mode_isActive_idx" ON "Meal"("mode", "isActive");
-- Seed the meal knowledge base from the previous hardcoded libraries.
INSERT INTO "Meal" ("id", "key", "title", "kcal", "tags", "mode", "isActive", "source", "createdAt", "updatedAt") VALUES
(gen_random_uuid()::text, 'chicken_broccoli', '鸡胸肉 + 西兰花', 420, '{"鸡肉","西兰花"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'salmon_salad', '煎三文鱼沙拉', 480, '{"三文鱼","生菜"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'beef_stirfry', '牛肉时蔬炒饭（少油）', 520, '{"牛肉","米饭"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'tofu_veggie_bowl', '豆腐时蔬盖饭', 400, '{"豆腐","米饭","素食"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'egg_avocado_toast', '水波蛋牛油果全麦吐司', 380, '{"鸡蛋","牛油果","面包"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'shrimp_zucchini', '虾仁西葫芦意面', 440, '{"虾","意面"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'turkey_wrap', '火鸡肉墨西哥卷', 410, '{"火鸡肉","卷饼"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'quinoa_chickpea', '藜麦鹰嘴豆沙拉', 390, '{"藜麦","鹰嘴豆","素食"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'steak_asparagus', '煎牛排配芦笋', 540, '{"牛肉","芦笋"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'mushroom_soup_bread', '菌菇浓汤 + 全麦面包', 360, '{"菌菇","面包","素食"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'pork_cabbage_stirfry', '瘦肉卷心菜炒', 430, '{"猪肉","卷心菜"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'tuna_rice_bowl', '金枪鱼糙米饭', 450, '{"金枪鱼","米饭"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'lentil_curry', '小扁豆咖喱（低脂）', 400, '{"扁豆","素食","咖喱"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'chicken_sweet_potato', '鸡胸肉 + 烤红薯', 460, '{"鸡肉","红薯"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'greek_yogurt_bowl', '希腊酸奶坚果碗', 350, '{"酸奶","坚果","素食"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'beef_broccoli_soup', '牛肉西兰花汤面（少面）', 470, '{"牛肉","西兰花","面条"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'eggplant_tofu', '茄子豆腐煲（少油）', 410, '{"茄子","豆腐","素食"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'cod_veggies', '清蒸鳕鱼时蔬', 380, '{"鳕鱼"}', 'cook', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_1meat2veg', '食堂：一荤两素 + 半份米饭（荤菜选蒸/炖，不选油炸）', 500, '{"食堂","米饭"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_fish_veg', '食堂：清蒸鱼或水煮鱼片 + 两个绿叶素菜', 450, '{"食堂","鱼"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_chicken_veg', '食堂：白切鸡/去皮鸡腿 + 素菜 + 少饭', 480, '{"食堂","鸡肉"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_beef_stew', '食堂：炖牛肉 + 两素，汤汁别浇饭', 520, '{"食堂","牛肉"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_tofu_egg', '食堂：豆腐/鸡蛋主菜 + 两素（清淡日）', 420, '{"食堂","豆腐","鸡蛋","素食"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_clear_noodle', '食堂：清汤面加蛋加青菜，面量减半', 450, '{"食堂","面条","鸡蛋"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_2veg_egg', '食堂：两素一蛋 + 粗粮饭（极清淡日）', 380, '{"食堂","素食","鸡蛋"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'canteen_shrimp_veg', '食堂：白灼虾/虾仁菜 + 素菜 + 半饭', 440, '{"食堂","虾"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_light_bowl', '外卖：轻食碗（鸡胸/牛肉沙拉，酱料减半）', 430, '{"外卖","轻食","鸡肉"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_malatang_clear', '外卖：清汤麻辣烫（豆制品+绿叶菜+少主食）', 400, '{"外卖","麻辣烫","豆腐"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_japanese_set', '外卖：日式定食（烤鱼/鸡肉，酱汁备注分开放）', 480, '{"外卖","日式","鱼"}', 'canteen', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_light_bowl2', '轻食碗：鸡胸肉沙拉，酱料减半或油醋汁', 430, '{"外卖","轻食","鸡肉"}', 'takeout', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_malatang_clear2', '清汤麻辣烫：豆制品 + 绿叶菜 + 少主食', 400, '{"外卖","麻辣烫","豆腐"}', 'takeout', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_japanese_set2', '日式定食：烤鱼或鸡肉，备注酱汁分开放', 480, '{"外卖","日式","鱼"}', 'takeout', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_pho', '越南粉/清汤米线：加瘦肉，不喝完汤', 450, '{"外卖","米线"}', 'takeout', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_sushi_roll', '寿司/饭团套餐：避开天妇罗和蛋黄酱卷', 460, '{"外卖","日式","米饭"}', 'takeout', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_chicken_bento', '鸡胸肉便当：备注少油少盐，饭吃一半', 470, '{"外卖","鸡肉","米饭"}', 'takeout', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_veggie_congee', '瘦肉/皮蛋瘦肉粥 + 拍黄瓜类凉菜', 380, '{"外卖","粥","猪肉"}', 'takeout', true, 'seed', now(), now()),
(gen_random_uuid()::text, 'takeout_grilled_fish_light', '轻烤鱼套餐：选清香/蒜香锅底，配菜多拿豆腐青菜', 520, '{"外卖","鱼","豆腐"}', 'takeout', true, 'seed', now(), now());
