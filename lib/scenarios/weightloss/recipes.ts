export type EatingMode = "cook" | "canteen" | "takeout";

export type Recipe = {
  key: string;
  title: string;
  kcal: number;
  /** Ingredient/style tags, matched against onboarding dislikedFoods substrings. */
  tags: string[];
};

// Small static libraries for v1. No LLM needed to generate these -- they're
// curated lists; the "intelligence" is in filtering/ranking, not generation.
//
// The library is picked by the user's eatingMode: recommending "煎三文鱼" to
// someone who eats at a company canteen is useless advice. For canteen/
// takeout modes the entries are not dishes to cook but *executable ordering
// strategies* -- things you can actually do at the serving window or in the
// delivery app. Same Recipe shape, so the planner/guardrails don't care.

/** eatingMode = "cook": dishes you make yourself. */
export const COOK_MEALS: Recipe[] = [
  { key: "chicken_broccoli", title: "鸡胸肉 + 西兰花", kcal: 420, tags: ["鸡肉", "西兰花"] },
  { key: "salmon_salad", title: "煎三文鱼沙拉", kcal: 480, tags: ["三文鱼", "生菜"] },
  { key: "beef_stirfry", title: "牛肉时蔬炒饭（少油）", kcal: 520, tags: ["牛肉", "米饭"] },
  { key: "tofu_veggie_bowl", title: "豆腐时蔬盖饭", kcal: 400, tags: ["豆腐", "米饭", "素食"] },
  { key: "egg_avocado_toast", title: "水波蛋牛油果全麦吐司", kcal: 380, tags: ["鸡蛋", "牛油果", "面包"] },
  { key: "shrimp_zucchini", title: "虾仁西葫芦意面", kcal: 440, tags: ["虾", "意面"] },
  { key: "turkey_wrap", title: "火鸡肉墨西哥卷", kcal: 410, tags: ["火鸡肉", "卷饼"] },
  { key: "quinoa_chickpea", title: "藜麦鹰嘴豆沙拉", kcal: 390, tags: ["藜麦", "鹰嘴豆", "素食"] },
  { key: "steak_asparagus", title: "煎牛排配芦笋", kcal: 540, tags: ["牛肉", "芦笋"] },
  { key: "mushroom_soup_bread", title: "菌菇浓汤 + 全麦面包", kcal: 360, tags: ["菌菇", "面包", "素食"] },
  { key: "pork_cabbage_stirfry", title: "瘦肉卷心菜炒", kcal: 430, tags: ["猪肉", "卷心菜"] },
  { key: "tuna_rice_bowl", title: "金枪鱼糙米饭", kcal: 450, tags: ["金枪鱼", "米饭"] },
  { key: "lentil_curry", title: "小扁豆咖喱（低脂）", kcal: 400, tags: ["扁豆", "素食", "咖喱"] },
  { key: "chicken_sweet_potato", title: "鸡胸肉 + 烤红薯", kcal: 460, tags: ["鸡肉", "红薯"] },
  { key: "greek_yogurt_bowl", title: "希腊酸奶坚果碗", kcal: 350, tags: ["酸奶", "坚果", "素食"] },
  { key: "beef_broccoli_soup", title: "牛肉西兰花汤面（少面）", kcal: 470, tags: ["牛肉", "西兰花", "面条"] },
  { key: "eggplant_tofu", title: "茄子豆腐煲（少油）", kcal: 410, tags: ["茄子", "豆腐", "素食"] },
  { key: "cod_veggies", title: "清蒸鳕鱼时蔬", kcal: 380, tags: ["鳕鱼"] },
];

/**
 * eatingMode = "canteen": how to compose a tray at a company canteen.
 * Includes a few takeout options (tagged 外卖) because canteen eaters
 * occasionally order delivery -- the model may pick one when memory shows
 * canteen fatigue or the user swapped away from canteen entries recently.
 */
export const CANTEEN_MEALS: Recipe[] = [
  { key: "canteen_1meat2veg", title: "食堂：一荤两素 + 半份米饭（荤菜选蒸/炖，不选油炸）", kcal: 500, tags: ["食堂", "米饭"] },
  { key: "canteen_fish_veg", title: "食堂：清蒸鱼或水煮鱼片 + 两个绿叶素菜", kcal: 450, tags: ["食堂", "鱼"] },
  { key: "canteen_chicken_veg", title: "食堂：白切鸡/去皮鸡腿 + 素菜 + 少饭", kcal: 480, tags: ["食堂", "鸡肉"] },
  { key: "canteen_beef_stew", title: "食堂：炖牛肉 + 两素，汤汁别浇饭", kcal: 520, tags: ["食堂", "牛肉"] },
  { key: "canteen_tofu_egg", title: "食堂：豆腐/鸡蛋主菜 + 两素（清淡日）", kcal: 420, tags: ["食堂", "豆腐", "鸡蛋", "素食"] },
  { key: "canteen_clear_noodle", title: "食堂：清汤面加蛋加青菜，面量减半", kcal: 450, tags: ["食堂", "面条", "鸡蛋"] },
  { key: "canteen_2veg_egg", title: "食堂：两素一蛋 + 粗粮饭（极清淡日）", kcal: 380, tags: ["食堂", "素食", "鸡蛋"] },
  { key: "canteen_shrimp_veg", title: "食堂：白灼虾/虾仁菜 + 素菜 + 半饭", kcal: 440, tags: ["食堂", "虾"] },
  { key: "takeout_light_bowl", title: "外卖：轻食碗（鸡胸/牛肉沙拉，酱料减半）", kcal: 430, tags: ["外卖", "轻食", "鸡肉"] },
  { key: "takeout_malatang_clear", title: "外卖：清汤麻辣烫（豆制品+绿叶菜+少主食）", kcal: 400, tags: ["外卖", "麻辣烫", "豆腐"] },
  { key: "takeout_japanese_set", title: "外卖：日式定食（烤鱼/鸡肉，酱汁备注分开放）", kcal: 480, tags: ["外卖", "日式", "鱼"] },
];

/** eatingMode = "takeout": ordering strategies for delivery apps. */
export const TAKEOUT_MEALS: Recipe[] = [
  { key: "takeout_light_bowl2", title: "轻食碗：鸡胸肉沙拉，酱料减半或油醋汁", kcal: 430, tags: ["外卖", "轻食", "鸡肉"] },
  { key: "takeout_malatang_clear2", title: "清汤麻辣烫：豆制品 + 绿叶菜 + 少主食", kcal: 400, tags: ["外卖", "麻辣烫", "豆腐"] },
  { key: "takeout_japanese_set2", title: "日式定食：烤鱼或鸡肉，备注酱汁分开放", kcal: 480, tags: ["外卖", "日式", "鱼"] },
  { key: "takeout_pho", title: "越南粉/清汤米线：加瘦肉，不喝完汤", kcal: 450, tags: ["外卖", "米线"] },
  { key: "takeout_sushi_roll", title: "寿司/饭团套餐：避开天妇罗和蛋黄酱卷", kcal: 460, tags: ["外卖", "日式", "米饭"] },
  { key: "takeout_chicken_bento", title: "鸡胸肉便当：备注少油少盐，饭吃一半", kcal: 470, tags: ["外卖", "鸡肉", "米饭"] },
  { key: "takeout_veggie_congee", title: "瘦肉/皮蛋瘦肉粥 + 拍黄瓜类凉菜", kcal: 380, tags: ["外卖", "粥", "猪肉"] },
  { key: "takeout_grilled_fish_light", title: "轻烤鱼套餐：选清香/蒜香锅底，配菜多拿豆腐青菜", kcal: 520, tags: ["外卖", "鱼", "豆腐"] },
];

const LIBRARIES: Record<EatingMode, Recipe[]> = {
  cook: COOK_MEALS,
  canteen: CANTEEN_MEALS,
  takeout: TAKEOUT_MEALS,
};

export function getMealLibrary(mode: string): Recipe[] {
  return LIBRARIES[(mode as EatingMode) in LIBRARIES ? (mode as EatingMode) : "canteen"];
}

const ALL_MEALS: Recipe[] = [...COOK_MEALS, ...CANTEEN_MEALS, ...TAKEOUT_MEALS];

/** Lookup across all libraries -- used by the whitelist's last-resort check and title/kcal resolution. */
export function getRecipeByKey(key: string): Recipe | undefined {
  return ALL_MEALS.find((r) => r.key === key);
}
