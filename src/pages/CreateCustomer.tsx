import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, Save, Building2, User, Phone, Mail, MapPin, Briefcase, Tag, X, StickyNote } from 'lucide-react'
import type { Customer } from '../types'
import { parseCustomerTags, serializeCustomerTags } from '../utils/customerTags'

export default function CreateCustomer() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = !!id
  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [industry, setIndustry] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (isEditMode) {
      loadCustomer()
    }
  }, [isEditMode, id])

  const loadCustomer = async () => {
    try {
      const customer = await api.customers.getById(id!) as Customer
      setName(customer.name)
      setContactPerson(customer.contact_person || '')
      setPhone(customer.phone || '')
      setEmail(customer.email || '')
      setAddress(customer.address || '')
      setIndustry(customer.industry || '')
      setTags(parseCustomerTags(customer.tags))
      setRemark(customer.remark || '')
    } catch (error) {
      console.error('加载客户信息失败:', error)
    }
  }

  /** 添加标签：回车或输入逗号触发，去重、去空、上限 10 个 */
  const handleAddTag = () => {
    const value = tagInput.trim().replace(/[,，]$/, '')
    if (!value) return
    if (tags.length >= 10) return
    if (!tags.includes(value)) {
      setTags([...tags, value])
    }
    setTagInput('')
  }

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      handleAddTag()
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (isEditMode) {
        await api.customers.update(id!, {
          name,
          contact_person: contactPerson,
          phone,
          email,
          address,
          industry,
          tags: serializeCustomerTags(tags),
          remark,
        })
      } else {
        await api.customers.create({
          name,
          contact_person: contactPerson,
          phone,
          email,
          address,
          industry,
          tags: serializeCustomerTags(tags),
          remark,
        })
      }

      navigate('/customers')
    } catch (error) {
      console.error('保存客户失败:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button
              onClick={() => navigate('/customers')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{isEditMode ? '编辑客户' : '添加客户'}</h1>
              <p className="text-gray-500 mt-1">{isEditMode ? '修改客户基本信息' : '填写客户基本信息'}</p>
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !name}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] justify-center shrink-0"
          >
            <Save size={20} />
            {loading ? '保存中...' : '保存'}
          </button>
        </div>

        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="flex items-center gap-2">
                    <Building2 size={18} />
                    客户名称 <span className="text-red-500">*</span>
                  </span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                  placeholder="请输入客户名称"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <User size={18} />
                      联系人
                    </span>
                  </label>
                  <input
                    type="text"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                    placeholder="请输入联系人姓名"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Phone size={18} />
                      联系电话
                    </span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                    placeholder="请输入联系电话"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Mail size={18} />
                      邮箱
                    </span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                    placeholder="请输入邮箱地址"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Briefcase size={18} />
                      行业
                    </span>
                  </label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                  >
                    <option value="">请选择行业</option>
                    <option value="IT">IT/互联网</option>
                    <option value="制造">制造业</option>
                    <option value="零售">零售业</option>
                    <option value="金融">金融业</option>
                    <option value="教育">教育行业</option>
                    <option value="医疗">医疗健康</option>
                    <option value="其他">其他</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="flex items-center gap-2">
                    <Tag size={18} />
                    客户标签
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2 p-2 border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500 min-h-[44px]">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-100 text-primary-700 text-sm rounded-full"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-primary-400 hover:text-primary-600"
                        aria-label={`移除标签 ${tag}`}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={handleAddTag}
                    className="flex-1 min-w-[120px] px-2 py-1 outline-none text-sm"
                    placeholder={tags.length === 0 ? '输入标签后按回车添加' : ''}
                    disabled={tags.length >= 10}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">最多 10 个标签，回车或逗号确认</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="flex items-center gap-2">
                    <MapPin size={18} />
                    地址
                  </span>
                </label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                  placeholder="请输入客户地址"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="flex items-center gap-2">
                    <StickyNote size={18} />
                    备注
                  </span>
                </label>
                <textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                  placeholder="请输入备注信息（如客户偏好、合作注意事项等）"
                />
              </div>

              <div className="flex gap-3 sm:gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/customers')}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors min-h-[44px]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading || !name}
                  className="flex-1 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                >
                  {loading ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
  )
}
