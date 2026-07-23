import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'
import { api } from '../api'
import type { Customer } from '../types'

interface CustomerSelectProps {
  value: string
  onChange: (value: string) => void
  address?: string
  onAddressChange?: (address: string) => void
  placeholder?: string
}

export default function CustomerSelect({ value, onChange, address, onAddressChange, placeholder = '请选择或输入客户名称' }: CustomerSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchCustomers()
  }, [])

  const fetchCustomers = async () => {
    const data = await api.customers.getAll()
    setCustomers(data)
    setFilteredCustomers(data)
  }

  useEffect(() => {
    if (searchTerm.trim()) {
      const filtered = customers.filter(
        (c) =>
          c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.phone?.includes(searchTerm)
      )
      setFilteredCustomers(filtered)
    } else {
      setFilteredCustomers(customers)
    }
  }, [searchTerm, customers])

  // 关闭下拉框
  const handleClose = useCallback(() => {
    setIsOpen(false)
    // 如果搜索框有输入且该客户不在列表中，将搜索值同步到主输入框
    if (searchTerm.trim()) {
      onChange(searchTerm.trim())
    }
    // 清空搜索框
    setSearchTerm('')
  }, [searchTerm, onChange])

  const handleSelect = useCallback((customer: Customer) => {
    onChange(customer.name)
    if (onAddressChange && customer.address) {
      onAddressChange(customer.address)
    }
    handleClose()
  }, [onChange, onAddressChange, handleClose])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    setSearchTerm(newValue)
    
    // 如果输入的名称不在客户列表中，清空地址
    const exists = customers.some((c) => c.name === newValue)
    if (!exists && onAddressChange) {
      onAddressChange('')
    }
  }, [onChange, customers, onAddressChange])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [handleClose])

  const selectedCustomer = customers.find((c) => c.name === value)

  return (
    <div className="relative" ref={dropdownRef}>
      <div
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
      >
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
          readOnly={isOpen}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {isOpen ? (
            <ChevronDown size={16} className="text-gray-400 rotate-180" />
          ) : (
            <ChevronDown size={16} className="text-gray-400" />
          )}
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索客户..."
                className="w-full pl-7 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X size={14} className="text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto max-h-48">
            {filteredCustomers.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                {searchTerm ? '未找到匹配的客户' : '暂无客户'}
              </div>
            ) : (
              filteredCustomers.map((customer) => (
                <div
                  key={customer.id}
                  onClick={() => handleSelect(customer)}
                  className={`px-4 py-2.5 text-sm cursor-pointer hover:bg-gray-50 transition-colors ${
                    customer.name === value ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="font-medium text-gray-800">{customer.name}</div>
                  {customer.phone && (
                    <div className="text-xs text-gray-500 mt-0.5">{customer.phone}</div>
                  )}
                  {customer.address && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{customer.address}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {selectedCustomer && !isOpen && (
        <div className="mt-1 text-xs text-gray-500">
          {selectedCustomer.phone && <span className="mr-2">{selectedCustomer.phone}</span>}
          {selectedCustomer.address && <span>{selectedCustomer.address}</span>}
        </div>
      )}
    </div>
  )
}
