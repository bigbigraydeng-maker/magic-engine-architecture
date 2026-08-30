/**
 * XCP（OpenSRS XML Command Protocol）的值模型。
 *
 * XCP 的数据只有三种形态：字符串、`dt_assoc`（键值表）、`dt_array`（有序表）。
 * 解析器把这三种原样映射过来，**不做任何语义解释**——把 `is_success` 的
 * "1" 翻译成 boolean 是调用方的事，不是协议层的事。
 */
export type XcpValue = string | XcpAssoc | XcpArray

export interface XcpAssoc {
  [key: string]: XcpValue
}

export type XcpArray = XcpValue[]

/** XCP 回包的通用外层字段（每个 REPLY 都有）。 */
export interface XcpReply {
  isSuccess: boolean
  responseCode: string
  responseText: string
  /** `attributes` 块，缺席时为空表。 */
  attributes: XcpAssoc
  /** 完整回包，给调用方在通用字段不够用时兜底。 */
  raw: XcpAssoc
}
